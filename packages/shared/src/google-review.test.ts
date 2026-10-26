import { describe, expect, it } from 'vitest';
import { isGoogleReviewUrl, tenantSettingsSchema } from './schemas';

describe('link de avaliação no Google', () => {
  it('aceita links do Google', () => {
    for (const u of ['https://g.page/r/CabcDEF123/review', 'https://maps.app.goo.gl/abc123', 'https://search.google.com/local/writereview?placeid=X', 'https://www.google.com.br/maps/place/x']) {
      expect(isGoogleReviewUrl(u)).toBe(true);
    }
  });

  it('recusa outros domínios e http', () => {
    for (const u of ['http://g.page/r/x/review', 'https://g.page.evil.com/x', 'https://evilgoogle.com/x', 'https://google.com.evil.io/x', 'javascript:alert(1)']) {
      expect(isGoogleReviewUrl(u)).toBe(false);
    }
  });

  it('campo vazio limpa o link', () => {
    expect(tenantSettingsSchema.parse({ googleReviewUrl: '' }).googleReviewUrl).toBeNull();
  });
});
