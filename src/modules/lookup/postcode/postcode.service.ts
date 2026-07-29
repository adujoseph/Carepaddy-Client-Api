import { z } from '@docs/zod-extend';
import { AppError } from '@middleware/error-handler';
import { logger } from '@lib/logger';

export const postcodeQuerySchema = z.object({
  postcode: z.string().trim().min(2).max(20),
});

export type PostcodeQuery = z.infer<typeof postcodeQuerySchema>;

export type AddressSuggestion = {
  postcode: string;
  fullAddress: string;
  city: string;
};

export interface PostcodeProvider {
  lookup(postcode: string): Promise<AddressSuggestion[]>;
}

export class PostcodesIoProvider implements PostcodeProvider {
  async lookup(postcode: string): Promise<AddressSuggestion[]> {
    const normalized = postcode.trim().replace(/\s+/g, '');
    const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(normalized)}`;

    let response: Response;
    try {
      response = await fetch(url);
    } catch (err) {
      logger.warn({ err, postcode }, 'postcodes.io request failed');
      throw new AppError(502, 'Postcode lookup unavailable', 'POSTCODE_UNAVAILABLE');
    }

    if (response.status === 404) {
      return [];
    }

    if (!response.ok) {
      logger.warn({ status: response.status, postcode }, 'postcodes.io non-OK response');
      throw new AppError(502, 'Postcode lookup unavailable', 'POSTCODE_UNAVAILABLE');
    }

    const json = (await response.json()) as {
      result?: {
        postcode?: string;
        admin_district?: string;
        parish?: string;
        region?: string;
        line_1?: string;
        thoroughfare?: string;
      };
    };

    const result = json.result;
    if (!result?.postcode) {
      return [];
    }

    const city = result.admin_district ?? result.parish ?? result.region ?? '';
    const line = result.thoroughfare ?? result.line_1 ?? result.postcode;
    const fullAddress = [line, city, result.postcode].filter(Boolean).join(', ');

    return [
      {
        postcode: result.postcode,
        fullAddress,
        city,
      },
    ];
  }
}

export const postcodeProvider: PostcodeProvider = new PostcodesIoProvider();

export async function lookupPostcode(query: PostcodeQuery): Promise<{ addresses: AddressSuggestion[] }> {
  const addresses = await postcodeProvider.lookup(query.postcode);
  return { addresses };
}
