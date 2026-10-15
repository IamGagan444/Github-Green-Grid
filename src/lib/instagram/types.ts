/** Message bodies accepted by the Instagram Send API. */

export interface UrlButton {
  type: "web_url";
  url: string;
  title: string;
}

export interface PostbackButton {
  type: "postback";
  title: string;
  payload: string;
}

export type OutgoingMessage =
  | { text: string }
  | {
      attachment: {
        type: "template";
        payload: { template_type: "button"; text: string; buttons: Array<UrlButton | PostbackButton> };
      };
    };

/** Normalised inbound webhook event (see `webhook.ts`). */
export type InboundEvent =
  | {
      kind: "COMMENT";
      igUserId: string;
      commentId: string;
      senderIgsid: string;
      senderUsername: string | null;
      mediaId: string | null;
      mediaProductType: string | null;
      text: string;
      occurredAt: Date;
    }
  | {
      kind: "MESSAGE" | "STORY_REPLY" | "STORY_MENTION";
      igUserId: string;
      mid: string;
      senderIgsid: string;
      text: string | null;
      occurredAt: Date;
    }
  | {
      kind: "POSTBACK";
      igUserId: string;
      mid: string;
      senderIgsid: string;
      payload: string;
      occurredAt: Date;
    };
