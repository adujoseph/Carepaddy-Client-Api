import { logger } from '@lib/logger';

export type CqcVerifyInput = {
  cqcNumber: string;
  name: string;
  postcode: string;
};

export type CqcVerifyResult = {
  valid: boolean;
  providerName?: string;
  location?: string;
};

export interface CqcProvider {
  verify(input: CqcVerifyInput): Promise<CqcVerifyResult>;
}

/** Deterministic mock — treats numbers starting with "VALID" as matching providers. */
export class MockCqcProvider implements CqcProvider {
  async verify(input: CqcVerifyInput): Promise<CqcVerifyResult> {
    const normalized = input.cqcNumber.trim().toUpperCase();
    if (normalized.startsWith('VALID')) {
      return {
        valid: true,
        providerName: input.name,
        location: input.postcode.toUpperCase().replace(/\s+/g, ''),
      };
    }
    return { valid: false };
  }
}

export const cqcProvider: CqcProvider = new MockCqcProvider();

export function runCqcCheckInBackground(
  carehomeId: string,
  input: CqcVerifyInput,
  update: (result: CqcVerifyResult) => Promise<void>,
): void {
  void (async () => {
    try {
      const result = await cqcProvider.verify(input);
      await update(result);
    } catch (err) {
      logger.warn({ err, carehomeId }, 'background CQC verification failed');
    }
  })();
}
