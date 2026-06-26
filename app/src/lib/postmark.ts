type PostmarkEmailInput = {
  to: string;
  subject: string;
  textBody: string;
};

type PostmarkEmailResult = {
  messageId: string | null;
  submittedAt: string | null;
};

type PostmarkResponse = {
  MessageID?: string;
  SubmittedAt?: string;
  ErrorCode?: number;
  Message?: string;
};

const POSTMARK_EMAIL_ENDPOINT = "https://api.postmarkapp.com/email";

export async function sendPostmarkEmail(input: PostmarkEmailInput): Promise<PostmarkEmailResult> {
  const token = requiredEnv("POSTMARK_SERVER_TOKEN");
  const from = requiredEnv("POSTMARK_FROM_EMAIL");
  const messageStream = process.env.POSTMARK_MESSAGE_STREAM?.trim();
  const replyTo = process.env.POSTMARK_REPLY_TO_EMAIL?.trim();

  const response = await fetch(POSTMARK_EMAIL_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": token,
    },
    body: JSON.stringify({
      From: from,
      To: input.to,
      Subject: input.subject,
      TextBody: input.textBody,
      ...(messageStream ? { MessageStream: messageStream } : {}),
      ...(replyTo ? { ReplyTo: replyTo } : {}),
    }),
  });

  const body = (await response.json().catch(() => null)) as PostmarkResponse | null;
  if (!response.ok) {
    const message = body?.Message ?? `Postmark returned HTTP ${response.status}`;
    throw new Error(`Postmark send failed: ${message}`);
  }

  return {
    messageId: body?.MessageID ?? null,
    submittedAt: body?.SubmittedAt ?? null,
  };
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}
