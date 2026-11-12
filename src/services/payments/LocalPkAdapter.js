import { PaymentAdapter } from './PaymentAdapter.js';
import { config } from '../../config.js';

export class LocalPkAdapter extends PaymentAdapter {
  constructor() {
    super('local_pk');
  }

  async createSession({ order, pkg }) {
    if (!config.payments.enableLocalPk) {
      const err = new Error('Local Pakistan transfer rail is disabled.');
      err.status = 403;
      throw err;
    }
    const pkrTotal = Math.round((order.final_cents / 100) * config.payments.pkrUsdRate);
    return {
      mode: 'local_pk',
      orderRef: order.order_ref,
      packageName: pkg.name,
      amountUsd: (order.final_cents / 100).toFixed(2),
      amountPkr: pkrTotal,
      exchangeRate: config.payments.pkrUsdRate,
      bankDetails: config.payments.localPk,
      redirectUrl: `/checkout/pending?ref=${encodeURIComponent(order.order_ref)}`,
    };
  }
}

