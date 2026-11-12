import { PaymentAdapter } from './PaymentAdapter.js';
import { config } from '../../config.js';

export class SandboxAdapter extends PaymentAdapter {
  constructor() {
    super('sandbox');
  }

  async createSession({ order, pkg }) {
    if (!config.payments.allowSandbox) {
      const err = new Error('Sandbox checkout is disabled in production.');
      err.status = 403;
      throw err;
    }
    return {
      mode: 'sandbox',
      orderRef: order.order_ref,
      amountCents: order.final_cents,
      packageName: pkg.name,
      supportedMethods: ['US Visa / Mastercard (Simulated)', 'Apple Pay (Simulated)', 'Google Pay (Simulated)'],
    };
  }
}

