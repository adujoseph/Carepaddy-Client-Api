import { z } from '@docs/zod-extend';
import { env } from '@config/env';
import { AppError } from '@middleware/error-handler';
import { logger } from '@lib/logger';

export const postcodeQuerySchema = z.object({
  postcode: z.string().trim().min(2).max(20),
});

export type PostcodeQuery = z.infer<typeof postcodeQuerySchema>;

export type AddressSuggestion = {
  postcode: string;
  fullAddress: string;
  line1: string;
  line2?: string;
  line3?: string;
  line4?: string;
  city: string;
  county?: string;
};

export interface PostcodeProvider {
  lookup(postcode: string): Promise<AddressSuggestion[]>;
}

/**
 * getAddress.io Find API — returns the full list of delivery points for a postcode
 * so the user can pick their address. Requires GETADDRESS_API_KEY.
 */
export class GetAddressProvider implements PostcodeProvider {
  constructor(private readonly apiKey: string) {}

  async lookup(postcode: string): Promise<AddressSuggestion[]> {
    const normalized = postcode.trim().replace(/\s+/g, '');
    const url =
      `https://api.getAddress.io/find/${encodeURIComponent(normalized)}` +
      `?api-key=${encodeURIComponent(this.apiKey)}&expand=true`;

    let response: Response;
    try {
      response = await fetch(url);
    } catch (err) {
      logger.warn({ err, postcode }, 'getAddress.io request failed');
      throw new AppError(502, 'Postcode lookup unavailable', 'POSTCODE_UNAVAILABLE');
    }

    if (response.status === 404) {
      return [];
    }

    if (response.status === 401 || response.status === 403) {
      logger.error({ status: response.status }, 'getAddress.io auth failed');
      throw new AppError(502, 'Postcode lookup unavailable', 'POSTCODE_UNAVAILABLE');
    }

    if (!response.ok) {
      logger.warn({ status: response.status, postcode }, 'getAddress.io non-OK response');
      throw new AppError(502, 'Postcode lookup unavailable', 'POSTCODE_UNAVAILABLE');
    }

    const json = (await response.json()) as {
      postcode?: string;
      addresses?: Array<
        | string
        | {
            line_1?: string;
            line_2?: string;
            line_3?: string;
            line_4?: string;
            town_or_city?: string;
            county?: string;
            formatted_address?: string[];
          }
      >;
    };

    const pc = json.postcode ?? postcode.trim().toUpperCase();
    const raw = json.addresses ?? [];

    return raw.map((item) => {
      if (typeof item === 'string') {
        const parts = item.split(',').map((p) => p.trim()).filter(Boolean);
        return {
          postcode: pc,
          fullAddress: [...parts, pc].join(', '),
          line1: parts[0] ?? pc,
          line2: parts[1],
          city: parts[parts.length - 2] ?? parts[parts.length - 1] ?? '',
        };
      }

      const line1 = item.line_1 ?? '';
      const line2 = item.line_2 || undefined;
      const line3 = item.line_3 || undefined;
      const line4 = item.line_4 || undefined;
      const city = item.town_or_city ?? '';
      const county = item.county || undefined;
      const formatted =
        item.formatted_address?.filter(Boolean).join(', ') ||
        [line1, line2, line3, line4, city, county, pc].filter(Boolean).join(', ');

      return {
        postcode: pc,
        fullAddress: formatted,
        line1,
        line2,
        line3,
        line4,
        city,
        county,
      };
    });
  }
}

function getProvider(): PostcodeProvider {
  if (!env.getAddressApiKey) {
    throw new AppError(
      503,
      'Address lookup is not configured. Set GETADDRESS_API_KEY.',
      'POSTCODE_NOT_CONFIGURED',
    );
  }
  return new GetAddressProvider(env.getAddressApiKey);
}

export async function lookupPostcode(
  query: PostcodeQuery,
): Promise<{ addresses: AddressSuggestion[] }> {
  const addresses = await getProvider().lookup(query.postcode);
  return { addresses };
}
