import { env } from '../../config/env.js';
import { fetchJson } from '../../lib/http.js';
import { toWhatsAppId } from '../../lib/phone.js';

const GRAPH_VERSION = 'v21.0';

export interface TemplateMessage {
  toE164: string;
  template: string;
  language?: string;
  /** Ordered values for {{1}}, {{2}}... in the template body. */
  bodyParams: string[];
  /** Optional dynamic URL suffix for a URL button (e.g. a payment link id). */
  urlButtonParam?: string;
}

/**
 * Sends an approved WhatsApp template message.
 * Templates must be pre-approved in Meta Business Manager — see docs/WHATSAPP_TEMPLATES.md.
 */
export async function sendTemplate(msg: TemplateMessage): Promise<{ messageId: string }> {
  const e = env();
  const components: unknown[] = [
    { type: 'body', parameters: msg.bodyParams.map((text) => ({ type: 'text', text })) },
  ];
  if (msg.urlButtonParam) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: msg.urlButtonParam }],
    });
  }
  const res = await fetchJson<{ messages: Array<{ id: string }> }>(
    `https://graph.facebook.com/${GRAPH_VERSION}/${e.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      op: 'whatsapp.send_template',
      method: 'POST',
      headers: { authorization: `Bearer ${e.WHATSAPP_TOKEN}` },
      body: {
        messaging_product: 'whatsapp',
        to: toWhatsAppId(msg.toE164),
        type: 'template',
        template: { name: msg.template, language: { code: msg.language ?? 'en' }, components },
      },
      retries: 2,
    },
  );
  return { messageId: res.messages[0]?.id ?? '' };
}
