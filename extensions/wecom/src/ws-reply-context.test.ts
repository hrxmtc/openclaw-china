import { afterEach, describe, expect, it } from "vitest";

import {
  appendWecomWsActiveStreamChunk,
  bindWecomWsRouteContext,
  clearWecomWsReplyContextsForAccount,
  finishWecomWsMessageContext,
  registerWecomWsEventContext,
  registerWecomWsMessageContext,
  sendWecomWsActiveTemplateCard,
} from "./ws-reply-context.js";

describe("wecom ws reply context", () => {
  afterEach(() => {
    clearWecomWsReplyContextsForAccount("acc-1");
  });

  it("separates multiple OpenClaw reply payloads with blank lines and repeats the final content on finish", async () => {
    const sent: unknown[] = [];
    registerWecomWsMessageContext({
      accountId: "acc-1",
      reqId: "req-1",
      to: "user:alice",
      send: async (frame) => {
        sent.push(frame);
      },
      streamId: "stream-1",
    });

    bindWecomWsRouteContext({
      accountId: "acc-1",
      reqId: "req-1",
      sessionKey: "session-1",
      runId: "run-1",
    });

    await expect(
      appendWecomWsActiveStreamChunk({
        accountId: "acc-1",
        to: "user:alice",
        chunk: "hello",
        runId: "run-1",
      })
    ).resolves.toBe(true);

    await expect(
      appendWecomWsActiveStreamChunk({
        accountId: "acc-1",
        to: "user:alice",
        chunk: "world",
        runId: "run-1",
      })
    ).resolves.toBe(true);

    await finishWecomWsMessageContext({
      accountId: "acc-1",
      reqId: "req-1",
    });

    expect(sent).toHaveLength(3);
    expect(sent[0]).toMatchObject({
      cmd: "aibot_respond_msg",
      headers: { req_id: "req-1" },
      body: {
        msgtype: "stream",
        stream: {
          id: "stream-1",
          finish: false,
          content: "hello",
        },
      },
    });
    expect(sent[1]).toMatchObject({
      cmd: "aibot_respond_msg",
      headers: { req_id: "req-1" },
      body: {
        msgtype: "stream",
        stream: {
          id: "stream-1",
          finish: false,
          content: "hello\n\nworld",
        },
      },
    });
    expect(sent[2]).toMatchObject({
      cmd: "aibot_respond_msg",
      headers: { req_id: "req-1" },
      body: {
        msgtype: "stream",
        stream: {
          id: "stream-1",
          finish: true,
          content: "hello\n\nworld",
        },
      },
    });
  });

  it("does not add an extra separator when the next payload already starts on a new line", async () => {
    const sent: unknown[] = [];
    registerWecomWsMessageContext({
      accountId: "acc-1",
      reqId: "req-3",
      to: "user:alice",
      send: async (frame) => {
        sent.push(frame);
      },
      streamId: "stream-3",
    });

    await appendWecomWsActiveStreamChunk({
      accountId: "acc-1",
      to: "user:alice",
      chunk: "hello",
    });

    await appendWecomWsActiveStreamChunk({
      accountId: "acc-1",
      to: "user:alice",
      chunk: "\nworld",
    });

    await finishWecomWsMessageContext({
      accountId: "acc-1",
      reqId: "req-3",
    });

    expect(sent[1]).toMatchObject({
      body: {
        stream: {
          content: "hello\nworld",
        },
      },
    });
    expect(sent[2]).toMatchObject({
      body: {
        stream: {
          content: "hello\nworld",
          finish: true,
        },
      },
    });
  });

  it("appends error details to the final stream snapshot", async () => {
    const sent: unknown[] = [];
    registerWecomWsMessageContext({
      accountId: "acc-1",
      reqId: "req-2",
      to: "user:alice",
      send: async (frame) => {
        sent.push(frame);
      },
      streamId: "stream-2",
    });

    await expect(
      appendWecomWsActiveStreamChunk({
        accountId: "acc-1",
        to: "user:alice",
        chunk: "partial answer",
      })
    ).resolves.toBe(true);

    await finishWecomWsMessageContext({
      accountId: "acc-1",
      reqId: "req-2",
      error: new Error("upstream failed"),
    });

    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({
      cmd: "aibot_respond_msg",
      headers: { req_id: "req-2" },
      body: {
        msgtype: "stream",
        stream: {
          id: "stream-2",
          finish: true,
          content: "partial answer\n\nError: upstream failed",
        },
      },
    });
  });

  it("sends template card updates through the active event context", async () => {
    const sent: unknown[] = [];
    registerWecomWsEventContext({
      accountId: "acc-1",
      reqId: "event-1",
      to: "user:alice",
      kind: "template_card_event",
      send: async (frame) => {
        sent.push(frame);
      },
    });

    await expect(
      sendWecomWsActiveTemplateCard({
        accountId: "acc-1",
        to: "user:alice",
        templateCard: { card_type: "button_interaction" },
      })
    ).resolves.toBe(true);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      cmd: "aibot_respond_update_msg",
      headers: { req_id: "event-1" },
      body: {
        response_type: "update_template_card",
        template_card: {
          card_type: "button_interaction",
        },
      },
    });
  });
});
