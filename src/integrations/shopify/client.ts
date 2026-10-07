import { env } from '../../config/env.js';
import { fetchJson } from '../../lib/http.js';
import type { ShippingAddress } from '../../db/schema.js';
import { SHOPIFY_WEBHOOK_TOPICS } from './webhooks.js';

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface UserError {
  field?: string[] | null;
  message: string;
}

export class ShopifyClient {
  constructor(
    private readonly shop: string,
    private readonly accessToken: string,
  ) {}

  private get endpoint() {
    return `https://${this.shop}/admin/api/${env().SHOPIFY_API_VERSION}/graphql.json`;
  }

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await fetchJson<GraphQLResponse<T>>(this.endpoint, {
      op: 'shopify.graphql',
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': this.accessToken },
      body: { query, variables },
    });
    if (res.errors?.length) throw new Error(`Shopify GraphQL error: ${res.errors.map((e) => e.message).join('; ')}`);
    if (!res.data) throw new Error('Shopify GraphQL returned no data');
    return res.data;
  }

  private static assertNoUserErrors(op: string, errors: UserError[] | undefined) {
    if (errors?.length) throw new Error(`${op}: ${errors.map((e) => e.message).join('; ')}`);
  }

  async registerWebhooks(callbackBase: string): Promise<void> {
    const mutation = /* GraphQL */ `
      mutation Sub($topic: WebhookSubscriptionTopic!, $url: URL!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: { callbackUrl: $url, format: JSON }) {
          userErrors { field message }
        }
      }`;
    for (const topic of SHOPIFY_WEBHOOK_TOPICS) {
      const data = await this.graphql<{ webhookSubscriptionCreate: { userErrors: UserError[] } }>(mutation, {
        topic,
        url: `${callbackBase}/webhooks/shopify`,
      });
      const errs = data.webhookSubscriptionCreate.userErrors.filter((e) => !/already been taken/i.test(e.message));
      ShopifyClient.assertNoUserErrors(`webhookSubscriptionCreate(${topic})`, errs);
    }
  }

  async shopInfo(): Promise<{ name: string }> {
    const data = await this.graphql<{ shop: { name: string } }>(`{ shop { name } }`);
    return data.shop;
  }

  async addTags(orderExternalId: string, tags: string[]): Promise<void> {
    const data = await this.graphql<{ tagsAdd: { userErrors: UserError[] } }>(
      `mutation Tags($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`,
      { id: `gid://shopify/Order/${orderExternalId}`, tags },
    );
    ShopifyClient.assertNoUserErrors('tagsAdd', data.tagsAdd.userErrors);
  }

  /** Used when a COD order is converted to prepaid via our payment link. */
  async markOrderPaid(orderExternalId: string): Promise<void> {
    const data = await this.graphql<{ orderMarkAsPaid: { userErrors: UserError[] } }>(
      `mutation Paid($input: OrderMarkAsPaidInput!) { orderMarkAsPaid(input: $input) { userErrors { field message } } }`,
      { input: { id: `gid://shopify/Order/${orderExternalId}` } },
    );
    ShopifyClient.assertNoUserErrors('orderMarkAsPaid', data.orderMarkAsPaid.userErrors);
  }

  /** Cancels the original order after its parcel is rerouted (no refund: it was COD/unpaid). */
  async cancelOrder(orderExternalId: string, staffNote: string): Promise<void> {
    const data = await this.graphql<{ orderCancel: { orderCancelUserErrors: UserError[] } }>(
      `mutation Cancel($orderId: ID!, $note: String) {
        orderCancel(orderId: $orderId, reason: DECLINED, refund: false, restock: false, notifyCustomer: false, staffNote: $note) {
          orderCancelUserErrors { field message }
        }
      }`,
      { orderId: `gid://shopify/Order/${orderExternalId}`, note: staffNote },
    );
    ShopifyClient.assertNoUserErrors('orderCancel', data.orderCancel.orderCancelUserErrors);
  }

  /**
   * Creates a paid order for the ReRoute buyer via draft order -> complete.
   * restock/inventory is untouched because the physical unit is already in transit.
   */
  async createPaidOrder(input: {
    lines: Array<{ variantId: string | null; title: string; quantity: number; unitPricePaise: number }>;
    /** Order-level discount so the final total equals exactly what the buyer paid. */
    discountPaise: number;
    address: ShippingAddress;
    note: string;
    tags: string[];
  }): Promise<{ orderExternalId: string; orderName: string }> {
    const [first, last = ''] = input.address.name.split(' ', 2);
    const draft = await this.graphql<{
      draftOrderCreate: { draftOrder: { id: string } | null; userErrors: UserError[] };
    }>(
      `mutation Draft($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) { draftOrder { id } userErrors { field message } }
      }`,
      {
        input: {
          note: input.note,
          tags: input.tags,
          phone: input.address.phoneE164,
          shippingAddress: {
            firstName: first,
            lastName: last,
            address1: input.address.address1,
            address2: input.address.address2,
            city: input.address.city,
            province: input.address.state,
            zip: input.address.pincode,
            countryCode: 'IN',
            phone: input.address.phoneE164,
          },
          appliedDiscount:
            input.discountPaise > 0
              ? { title: 'ReRoute nearby price', valueType: 'FIXED_AMOUNT', value: input.discountPaise / 100 }
              : undefined,
          lineItems: input.lines.map((l) => ({
            title: l.title,
            quantity: l.quantity,
            originalUnitPrice: (l.unitPricePaise / 100).toFixed(2),
            requiresShipping: true,
            taxable: true,
          })),
        },
      },
    );
    ShopifyClient.assertNoUserErrors('draftOrderCreate', draft.draftOrderCreate.userErrors);
    const draftId = draft.draftOrderCreate.draftOrder?.id;
    if (!draftId) throw new Error('draftOrderCreate returned no draft');

    const done = await this.graphql<{
      draftOrderComplete: { draftOrder: { order: { id: string; name: string } | null } | null; userErrors: UserError[] };
    }>(
      `mutation Complete($id: ID!) {
        draftOrderComplete(id: $id) { draftOrder { order { id name } } userErrors { field message } }
      }`,
      { id: draftId },
    );
    ShopifyClient.assertNoUserErrors('draftOrderComplete', done.draftOrderComplete.userErrors);
    const order = done.draftOrderComplete.draftOrder?.order;
    if (!order) throw new Error('draftOrderComplete returned no order');
    return { orderExternalId: order.id.split('/').pop() ?? order.id, orderName: order.name };
  }
}
