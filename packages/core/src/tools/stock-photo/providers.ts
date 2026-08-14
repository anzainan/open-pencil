import { ofetch } from 'ofetch'

export interface StockPhotoResult {
  url: string
  thumbnail?: string
  width: number
  height: number
  photographer: string
  sourceId: string
}

export interface StockPhotoSearchOptions {
  perPage: number
  orientation?: 'landscape' | 'portrait' | 'square'
  targetDim: number
  page?: number
  size?: 'small' | 'medium' | 'large'
  color?: string
}

export interface StockPhotoPageResult {
  results: StockPhotoResult[]
  total: number
  nextPage: number | null
}

export interface StockPhotoProvider {
  name: string
  search(query: string, options: StockPhotoSearchOptions): Promise<StockPhotoResult[]>
  searchPage?(query: string, options: StockPhotoSearchOptions): Promise<StockPhotoPageResult>
}

const providers = new Map<string, StockPhotoProvider>()
let activeProviderId: string | null = null

export function registerStockPhotoProvider(provider: StockPhotoProvider): void {
  providers.set(provider.name, provider)
  if (!activeProviderId) activeProviderId = provider.name
}

export function setActiveStockPhotoProvider(name: string | null): void {
  activeProviderId = name
}

export function getStockPhotoProviders(): string[] {
  return [...providers.keys()]
}

export function getActiveProvider(): StockPhotoProvider | null {
  if (!activeProviderId) return null
  return providers.get(activeProviderId) ?? null
}

interface PexelsPhoto {
  id: number
  width: number
  height: number
  photographer: string
  src: {
    original: string
    large2x: string
    large: string
    medium: string
    small: string
    landscape: string
  }
}

function pickPexelsSize(src: PexelsPhoto['src'], targetDim: number): string {
  if (targetDim <= 200) return src.small
  if (targetDim <= 400) return src.medium
  if (targetDim <= 800) return src.large
  if (targetDim <= 1600) return src.large2x
  return src.original
}

let pexelsAPIKey: string | null = null

export function setPexelsAPIKey(key: string | null): void {
  pexelsAPIKey = key
  if (key) {
    registerStockPhotoProvider(pexelsProvider)
    setActiveStockPhotoProvider('pexels')
  }
}

interface PexelsSearchResponse {
  photos: PexelsPhoto[]
  total_results: number
  page: number
  per_page: number
  next_page: string | null
}

async function pexelsSearchPage(
  query: string,
  options: StockPhotoSearchOptions
): Promise<StockPhotoPageResult> {
  if (!pexelsAPIKey) throw new Error('Pexels API key not configured')
  const { perPage, orientation, targetDim, page = 1, size, color } = options
  const params: Record<string, string | number> = { query, per_page: perPage, page }
  if (orientation) params.orientation = orientation
  if (size) params.size = size
  if (color) params.color = color

  const response = await ofetch.raw<PexelsSearchResponse>('https://api.pexels.com/v1/search', {
    headers: { Authorization: pexelsAPIKey },
    ignoreResponseError: true,
    query: params,
    retry: 0
  })
  if (!response.ok) throw new Error(`Pexels ${response.status}`)
  const data = response._data as PexelsSearchResponse
  const results = data.photos.map((photo) => ({
    url: pickPexelsSize(photo.src, targetDim),
    thumbnail: photo.src.small,
    width: photo.width,
    height: photo.height,
    photographer: photo.photographer,
    sourceId: String(photo.id)
  }))
  const nextPage = page * perPage < data.total_results ? page + 1 : null
  return { results, total: data.total_results, nextPage }
}

const pexelsProvider: StockPhotoProvider = {
  name: 'pexels',
  search(query, options) {
    return pexelsSearchPage(query, options).then((result) => result.results)
  },
  searchPage: pexelsSearchPage
}

let unsplashAccessKey: string | null = null

export function setUnsplashAccessKey(key: string | null): void {
  unsplashAccessKey = key
  if (key) {
    registerStockPhotoProvider(unsplashProvider)
  }
}

interface UnsplashPhoto {
  id: string
  width: number
  height: number
  urls: { raw: string; full: string; regular: string; small: string; thumb: string }
  user: { name: string }
  links: { download_location: string }
}

function pickUnsplashSize(urls: UnsplashPhoto['urls'], targetDim: number): string {
  if (targetDim <= 200) return urls.thumb
  if (targetDim <= 400) return urls.small
  if (targetDim <= 1080) return urls.regular
  return urls.full
}

interface UnsplashSearchResponse {
  results: UnsplashPhoto[]
  total: number
  total_pages: number
}

async function unsplashSearchPage(
  query: string,
  options: StockPhotoSearchOptions
): Promise<StockPhotoPageResult> {
  if (!unsplashAccessKey) throw new Error('Unsplash access key not configured')
  const { perPage, orientation, page = 1 } = options
  const orient = orientation === 'square' ? 'squarish' : orientation
  const params: Record<string, string | number> = { query, per_page: perPage, page }
  if (orient) params.orientation = orient
  const response = await ofetch.raw<UnsplashSearchResponse>(
    'https://api.unsplash.com/search/photos',
    {
      headers: {
        Authorization: `Client-ID ${unsplashAccessKey}`,
        'Accept-Version': 'v1'
      },
      ignoreResponseError: true,
      query: params,
      retry: 0
    }
  )
  if (!response.ok) throw new Error(`Unsplash ${response.status}`)
  const data = response._data as UnsplashSearchResponse
  const results = data.results.map((photo) => ({
    url: pickUnsplashSize(photo.urls, 1080),
    thumbnail: photo.urls.thumb,
    width: photo.width,
    height: photo.height,
    photographer: photo.user.name,
    sourceId: photo.id
  }))
  const nextPage = page < data.total_pages ? page + 1 : null
  return { results, total: data.total, nextPage }
}

const unsplashProvider: StockPhotoProvider = {
  name: 'unsplash',
  search(query, options) {
    return unsplashSearchPage(query, options).then((result) => result.results)
  },
  searchPage: unsplashSearchPage
}
