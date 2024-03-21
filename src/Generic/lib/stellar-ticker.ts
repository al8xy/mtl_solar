import { workers } from "~Workers/worker-controller"
import { createPersistentCache } from "./persistent-cache"

export interface AssetRecord {
  code: string
  desc: string
  issuer: string
  issuer_detail: {
    name: string
    url: string
  }
  name: string
  num_accounts: number
  status: string
  type: string
}

const assetsCache = createPersistentCache<AssetRecord[]>("known-assets", { expiresIn: 60 * 60_000 })

export async function fetchAllAssets(testnet: boolean): Promise<AssetRecord[]> {
  const cacheKey = testnet ? "testnet" : "mainnet"
  const tickerURL = testnet ? "https://ticker-testnet.kamni.io" : "https://ticker.kamni.io"

  const cachedAssets = assetsCache.read(cacheKey)

  if (cachedAssets) {
    return cachedAssets
  }

  try {
    const { netWorker } = await workers
    const allAssets = await netWorker.fetchAllAssets(tickerURL)

    assetsCache.save(cacheKey, allAssets)
    return allAssets
  } catch (e) {
    return []
  }
}
