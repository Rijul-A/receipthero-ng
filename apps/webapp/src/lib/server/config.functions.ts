import { createServerFn } from '@tanstack/react-start'
import { apiCall } from './api-client'
import type { Config } from '@sm-rn/shared/schemas'

export interface SaveConfigResponse {
  success: boolean
  message: string
  error?: {
    name: string
    message: string
    issues?: Array<unknown>
  }
}

/**
 * Get current configuration with masked API keys - proxies to GET /api/config
 */
export const getConfig = createServerFn({ method: 'GET' }).handler(async () => {
  return apiCall<Config>('/api/config')
})

/**
 * Save configuration (partial update) - proxies to PATCH /api/config
 * Note: Type assertion used due to TanStack Start typing limitations with complex input validators.
 */
export const saveConfig = createServerFn({ method: 'POST' })
  .inputValidator((input: Partial<Config>) => input)
  .handler((async ({ data }: any) => {
    return apiCall<SaveConfigResponse>('/api/config', {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }) as any) as (opts: { data: Partial<Config> }) => Promise<SaveConfigResponse>

export interface CurrencyInfo {
  code: string
  name: string
  symbol: string
}

export interface CurrenciesResponse {
  success: boolean
  currencies: Array<CurrencyInfo>
}

/**
 * Get available currencies - proxies to GET /api/config/currencies
 */
export const getAvailableCurrencies = createServerFn({ method: 'GET' }).handler(
  async () => {
    return apiCall<CurrenciesResponse>('/api/config/currencies')
  },
)
