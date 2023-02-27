import { z } from "zod";
import { router, withUserServersProcedure } from "~api/router/trpc";
import {
  addAuthorsToMessages,
  addReferencesToMessages,
  findChannelById,
  findMessageById,
  findMessagesByChannelId,
  findServerById,
  getParentChannelOfMessage,
  getThreadIdOfMessage,
  searchMessages,
} from "@answeroverflow/db";
import { findOrThrowNotFound } from "~api/utils/operations";
import {
  canUserViewPrivateMessage,
  stripPrivateChannelData,
  stripPrivateMessageData,
  stripPrivateServerData,
} from "~api/utils/permissions";
import { TRPCError } from "@trpc/server";

export const messagesRouter = router({
  /*
    Message page by ID
    Variants:
      - Root Message Not Found
      - Text channel thread message that has a parent message
      - Text channel thread message that has no parent message
      - Text channel thread message starting from anywhere in the thread
      - Forum post from root message of post
      - Forum post from any other message in the post
  */
  threadFromMessageId: withUserServersProcedure.input(z.string()).query(async ({ input, ctx }) => {
    // This is the message we're starting from
    const targetMessage = await findOrThrowNotFound(
      () => findMessageById(input),
      "Target message not found"
    );

    // Declare as const to make Typescript not yell at us when used in arrow functions
    const threadId = getThreadIdOfMessage(targetMessage);
    // TODO: These should maybe be a different error code
    const parentId = getParentChannelOfMessage(targetMessage);

    if (!parentId) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Message has no parent channel",
      });
    }

    const threadFetch = threadId
      ? findOrThrowNotFound(() => findChannelById(threadId), "Thread not found")
      : undefined;

    const serverFetch = findOrThrowNotFound(
      () => findServerById(targetMessage.serverId),
      "Server for message not found"
    );
    const parentChannelFetch = threadId
      ? findOrThrowNotFound(() => findChannelById(parentId), "Parent channel for message not found")
      : findOrThrowNotFound(
          () => findChannelById(targetMessage.channelId),
          "Channel for message not found"
        );

    const messageFetch = threadId
      ? findMessagesByChannelId({
          channelId: threadId,
        })
      : findMessagesByChannelId({
          channelId: parentId,
          after: targetMessage.id,
          limit: 20,
        });

    const [thread, server, channel, messages, rootMessage] = await Promise.all([
      threadFetch,
      serverFetch,
      parentChannelFetch,
      messageFetch,
      threadId ? findMessageById(threadId) : undefined,
    ]);

    // We've collected all of the data, now we need to strip out the private info
    const messagesWithRefs = await addReferencesToMessages(
      threadId && rootMessage ? [...new Set([rootMessage, ...messages])] : messages
    );
    const messagesWithDiscordAccounts = await addAuthorsToMessages(messagesWithRefs);
    return {
      messages: messagesWithDiscordAccounts.map((message) =>
        stripPrivateMessageData(message, ctx.userServers)
      ),
      parentChannel: stripPrivateChannelData(channel),
      server: stripPrivateServerData(server),
      thread: thread ? stripPrivateChannelData(thread) : undefined,
    };
  }),
  search: withUserServersProcedure
    .input(
      z.object({
        query: z.string(),
        serverId: z.string().optional(),
        channelId: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const searchResults = await searchMessages(input);
      const strippedSearchResults = searchResults.map(
        ({ message, channel, server, thread, score }) => ({
          message: stripPrivateMessageData(message, ctx.userServers),
          channel: stripPrivateChannelData(channel),
          server: stripPrivateServerData(server),
          thread: thread ? stripPrivateChannelData(thread) : undefined,
          score,
        })
      );
      return strippedSearchResults.filter(
        (result) =>
          canUserViewPrivateMessage(ctx.userServers, result.message) || result.message.public
      );
    }),
});