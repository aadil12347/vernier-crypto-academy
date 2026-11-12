import crypto from 'node:crypto';
import { PaymentAdapter } from './PaymentAdapter.js';
import { config } from '../../config.js';

export class CryptoAutoAdapter extends PaymentAdapter {
  constructor() {
    super('crypto_auto');
  }

  async createSession({ order, pkg }) {
    if (!config.payments.enableCryptoAuto || !config.payments.nowpayments.apiKey) {
      const err = new Error('Automated crypto gateway (NOWPayments) is not configured yet. Use Direct USDT or Sandbox.');
      err.status = 400;
      throw err;
    }
    const resp = await fetch('https://api.nowpayments.io/v1/invoice', {
      method: 'POST',
      headers: {
        'x-api-key': config.payments.nowpayments.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        price_amount: Number((order.final_cents / 100).toFixed(2)),
        price_currency: 'usd',
        order_id: order.order_ref,
        order_description: `${pkg.name} (${order.order_ref})`,
        ipn_callback_url: `${config.appUrl}/api/v1/webhooks/crypto`,
        success_url: `${config.appUrl}/checkout/success?ref=${encodeURIComponent(order.order_ref)}`,
        cancel_url: `${config.appUrl}/checkout/${pkg.slug}`,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      const err = new Error(`NOWPayments error: ${text}`);
      err.status = 502;
      throw err;
    }
    const data = await resp.json();
    return {
      mode: 'crypto_auto',
      orderRef: order.order_ref,
      invoiceUrl: data.invoice_url,
      invoiceId: String(data.id || ''),
    };
  }

  static verifyIpnSignature(rawBodyObj, signatureHeader) {
    const secret = config.payments.nowpayments.ipnSecret;
    if (!secret || !signatureHeader) return false;
    const sorted = Object.keys(rawBodyObj)
      .sort()
      .reduce((acc, k) => {
        acc[k] = rawBodyObj[k];
        return acc;
      }, {});
    const hmac = crypto.createHmac('sha512', secret).update(JSON.stringify(sorted)).digest('hex');
    const a = Buffer.from(hmac);
    const b = Buffer.from(String(signatureHeader));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}

