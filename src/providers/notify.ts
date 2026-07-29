import { sendEmail } from '@lib/notification/email';
import { sendSms } from '@lib/notification/sms';

export interface EmailSender {
  send(options: { to: string; subject: string; body: string }): Promise<void>;
}

export interface SmsSender {
  send(options: { to: string; body: string }): Promise<void>;
}

export const emailSender: EmailSender = {
  send: ({ to, subject, body }) => sendEmail(to, subject, body),
};

export const smsSender: SmsSender = {
  send: ({ to, body }) => sendSms(to, body),
};
