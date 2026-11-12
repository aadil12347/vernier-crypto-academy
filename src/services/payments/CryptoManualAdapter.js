import { PaymentAdapter } from './PaymentAdapter.js';
import { config } from '../../config.js';

export class CryptoManualAdapter extends PaymentAdapter {
  constructor() {
    super('crypto_manual');
  }

  async createSession({ order, pkg, network = 'USDT_TRC20' }) {
    if (!config.payments.enableCryptoManual) {
      const err = new Error('Manual crypto rail is disabled.');
      err.status = 403;
      throw err;
    }
    const wallets = config.payments.cryptoWallets;
    const chosenNetwork = wallets[network] ? network : 'USDT_TRC20';
    return {
      mode: 'crypto_manual',
      orderRef: order.order_ref,
      packageName: pkg.name,
      amountUsd: (order.final_cents / 100).toFixed(2),
      network: chosenNetwork,
      walletAddress: wallets[chosenNetwork],
      availableNetworks: Object.entries(wallets).map(([key, address]) => ({ key, address })),
      redirectUrl: `/checkout/pending?ref=${encodeURIComponent(order.order_ref)}`,
    };
  }
}

