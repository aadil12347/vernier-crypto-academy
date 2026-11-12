export class PaymentAdapter {
  constructor(name) {
    this.name = name;
  }
  async createSession() {
    throw new Error(`createSession not implemented for ${this.name}`);
  }
}

