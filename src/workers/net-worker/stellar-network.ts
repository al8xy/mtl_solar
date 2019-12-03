import "eventsource"
import PromiseQueue from "p-queue"
import qs from "qs"
import { Asset, FederationServer, Horizon, ServerApi } from "stellar-sdk"
import { map, Observable } from "@andywer/observable-fns"
import pkg from "../../../package.json"
import { Cancellation } from "../../lib/errors"
import { parseAssetID } from "../../lib/stellar"
import { max } from "../../lib/strings"
import { createReconnectingSSE } from "../_util/event-source"
import { parseJSONResponse } from "../_util/rest"
import { subscribeToUpdatesAndPoll } from "../_util/subscription"

export interface CollectionPage<T> {
  _embedded: {
    records: T[]
  }
  _links: {
    self: {
      href: string
    }
    next: {
      href: string
    }
    prev: {
      href: string
    }
  }
}

const accountSubscriptionCache = new Map<string, Observable<Horizon.AccountResponse>>()
const effectsSubscriptionCache = new Map<string, Observable<ServerApi.EffectRecord>>()
const orderbookSubscriptionCache = new Map<string, Observable<ServerApi.OrderbookRecord>>()
const ordersSubscriptionCache = new Map<string, Observable<ServerApi.OfferRecord[]>>()
const transactionsSubscriptionCache = new Map<string, Observable<Horizon.TransactionResponse>>()

const accountDataCache = new Map<string, Horizon.AccountResponse | null>()
const accountDataWaitingCache = new Map<string, ReturnType<typeof waitForAccountDataUncached>>()

// Limit the number of concurrent fetches
const fetchQueue = new PromiseQueue({ concurrency: 8 })

const identification = {
  "X-Client-Name": "Solar",
  "X-Client-Version": pkg.version
}

const createAccountCacheKey = (horizonURL: string, accountID: string) => `${horizonURL}:${accountID}`
const createOrderbookCacheKey = (horizonURL: string, sellingAsset: string, buyingAsset: string) =>
  `${horizonURL}:${sellingAsset}:${buyingAsset}`

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function cachify<T, Args extends any[]>(
  cache: Map<string, Observable<T>>,
  subscribe: (...args: Args) => Observable<T>,
  createCacheKey: (...args: Args) => string
): (...args: Args) => Observable<T> {
  return (...args: Args) => {
    const cacheKey = createCacheKey(...args)
    const cached = cache.get(cacheKey)

    if (cached) {
      return cached
    } else {
      const observable = subscribe(...args)
      cache.set(cacheKey, observable)
      return observable
    }
  }
}

export async function checkHorizonOrFailover(primaryHorizonURL: string, secondaryHorizonURL: string) {
  try {
    const primaryResponse = await fetch(primaryHorizonURL)
    if (primaryResponse.ok) {
      return primaryHorizonURL
    }
  } catch (error) {
    // tslint:disable-next-line no-console
    console.error(error)
  }

  const secondaryResponse = await fetch(secondaryHorizonURL)
  return secondaryResponse.ok ? secondaryHorizonURL : primaryHorizonURL
}

export function resolveStellarAddress(address: string, options?: FederationServer.Options) {
  return FederationServer.resolve(address, options)
}

async function waitForAccountDataUncached(horizonURL: string, accountID: string, shouldCancel?: () => boolean) {
  let accountData = null
  let initialFetchFailed = false

  for (let interval = 2500; ; interval = Math.min(interval * 1.05, 8000)) {
    if (shouldCancel && shouldCancel()) {
      throw Cancellation("Stopping to wait for account to become present in network.")
    }

    const url = new URL(`/accounts/${accountID}`, horizonURL)
    const response = await fetch(String(url) + "?" + qs.stringify(identification))

    if (response.status === 200) {
      accountData = await parseJSONResponse<Horizon.AccountResponse>(response)
      break
    } else if (response.status === 404) {
      initialFetchFailed = true
      await delay(interval)
    } else {
      throw Error(`Request to ${response.url} failed with status ${response.status}`)
    }
  }

  return {
    accountData,
    initialFetchFailed
  }
}

async function waitForAccountData(horizonURL: string, accountID: string, shouldCancel?: () => boolean) {
  // Cache promise to make sure we don't poll the same account twice simultaneously
  const cacheKey = createAccountCacheKey(horizonURL, accountID)
  const pending = accountDataWaitingCache.get(cacheKey)

  if (pending) {
    return pending
  } else {
    const justStarted = waitForAccountDataUncached(horizonURL, accountID, shouldCancel)
    accountDataWaitingCache.set(cacheKey, justStarted)
    justStarted.then(() => accountDataWaitingCache.delete(cacheKey), () => accountDataWaitingCache.delete(cacheKey))
    return justStarted
  }
}

function subscribeToAccountEffectsUncached(horizonURL: string, accountID: string) {
  let latestCursor: string | undefined
  let latestEffectCreatedAt: string | undefined

  return subscribeToUpdatesAndPoll<ServerApi.EffectRecord>(
    {
      async applyUpdate(update) {
        latestCursor = update.paging_token
        latestEffectCreatedAt = update.created_at
        return update
      },
      async fetchUpdate(streamedUpdate) {
        if (streamedUpdate) {
          return streamedUpdate
        } else {
          const effect = await fetchLatestAccountEffect(horizonURL, accountID)
          return effect || undefined
        }
      },
      async init() {
        let effect = await fetchLatestAccountEffect(horizonURL, accountID)

        if (!effect) {
          await waitForAccountData(horizonURL, accountID)
          effect = await fetchLatestAccountEffect(horizonURL, accountID)
        }

        latestCursor = effect ? effect.paging_token : latestCursor
        latestEffectCreatedAt = effect ? effect.created_at : latestEffectCreatedAt

        return effect || undefined
      },
      shouldApplyUpdate(update) {
        return (
          !latestEffectCreatedAt || (update.created_at >= latestEffectCreatedAt && update.paging_token !== latestCursor)
        )
      },
      subscribeToUpdates() {
        const createURL = () => {
          const query = {
            ...identification,
            cursor: latestCursor || "now"
          }
          return String(new URL(`/accounts/${accountID}/effects?${qs.stringify(query)}`, horizonURL))
        }

        return new Observable<ServerApi.EffectRecord>(observer => {
          return createReconnectingSSE(createURL, {
            onMessage(message) {
              const effect: ServerApi.EffectRecord = JSON.parse(message.data)
              latestCursor = effect.paging_token
              observer.next(effect)

              if (effect.type === "account_removed" && effect.account === accountID) {
                observer.complete()
              }
            },
            onUnexpectedError(error) {
              observer.error(error)
            }
          })
        })
      }
    },
    {
      retryFetchOnNoUpdate: false
    }
  )
}

export const subscribeToAccountEffects = cachify(
  effectsSubscriptionCache,
  subscribeToAccountEffectsUncached,
  createAccountCacheKey
)

function subscribeToAccountUncached(horizonURL: string, accountID: string) {
  let latestSnapshot: string | undefined

  const cacheKey = createAccountCacheKey(horizonURL, accountID)
  const createSnapshot = (accountData: Horizon.AccountResponse) =>
    JSON.stringify([accountData.sequence, accountData.balances])

  return subscribeToUpdatesAndPoll<Horizon.AccountResponse | null>({
    async applyUpdate(update) {
      if (update) {
        accountDataCache.set(cacheKey, update)
        latestSnapshot = createSnapshot(update)
      }
      return update
    },
    async fetchUpdate() {
      const accountData = await fetchAccountData(horizonURL, accountID)
      return accountData || undefined
    },
    async init() {
      const lastKnownAccountData = accountDataCache.get(cacheKey)

      if (lastKnownAccountData) {
        latestSnapshot = createSnapshot(lastKnownAccountData)
        return lastKnownAccountData
      } else {
        const { accountData: initialAccountData } = await waitForAccountData(horizonURL, accountID)

        accountDataCache.set(cacheKey, initialAccountData)
        latestSnapshot = createSnapshot(initialAccountData)

        return initialAccountData
      }
    },
    shouldApplyUpdate(update) {
      return Boolean(update && (!latestSnapshot || createSnapshot(update) !== latestSnapshot))
    },
    subscribeToUpdates() {
      return map(subscribeToAccountEffects(horizonURL, accountID), () => fetchAccountData(horizonURL, accountID))
    }
  })
}

export const subscribeToAccount = cachify(accountSubscriptionCache, subscribeToAccountUncached, createAccountCacheKey)

function subscribeToAccountTransactionsUncached(horizonURL: string, accountID: string) {
  let latestCreatedAt: string | undefined
  let latestCursor: string | undefined

  const fetchUpdate = async () => {
    const page = await fetchAccountTransactions(horizonURL, accountID, {
      cursor: latestCursor,
      limit: 15,
      order: "desc"
    })
    return page._embedded.records
  }

  return subscribeToUpdatesAndPoll<Horizon.TransactionResponse[]>({
    async applyUpdate(update) {
      const prevLatestCreatedAt = latestCreatedAt

      if (update.length > 0) {
        latestCreatedAt = max(update.map(tx => tx.created_at), "0")
        latestCursor = update.find(tx => tx.created_at === latestCreatedAt)!.paging_token
      }
      return update.filter(tx => !prevLatestCreatedAt || tx.created_at > prevLatestCreatedAt)
    },
    fetchUpdate,
    async init() {
      await waitForAccountData(horizonURL, accountID)
      return fetchUpdate()
    },
    shouldApplyUpdate(update) {
      return update.length > 0 && (!latestCreatedAt || update[0].created_at > latestCreatedAt)
    },
    subscribeToUpdates() {
      return map(subscribeToAccountEffects(horizonURL, accountID), () => fetchUpdate())
    }
  }).flatMap((txs: Horizon.TransactionResponse[]) => Observable.from(txs))
}

export const subscribeToAccountTransactions = cachify(
  transactionsSubscriptionCache,
  subscribeToAccountTransactionsUncached,
  createAccountCacheKey
)

function subscribeToOpenOrdersUncached(horizonURL: string, accountID: string) {
  let latestCursor: string | undefined
  let latestSetEmpty = false

  const fetchUpdate = async () => {
    const page = await fetchAccountOpenOrders(horizonURL, accountID, { cursor: latestCursor })
    return page._embedded.records
  }

  return subscribeToUpdatesAndPoll<ServerApi.OfferRecord[]>({
    async applyUpdate(update) {
      if (update.length > 0) {
        const latestID = max(update.map(offer => String(offer.id)), "0")
        latestCursor = update.find(offer => String(offer.id) === latestID)!.paging_token
      }

      latestSetEmpty = update.length === 0
      return update
    },
    fetchUpdate,
    async init() {
      const records = await fetchUpdate()

      if (records.length > 0) {
        latestCursor = records[0].paging_token
      }

      return records
    },
    shouldApplyUpdate(update) {
      const latestUpdateCursor = max(update.map(record => record.paging_token), "0")
      const emptySet = !latestUpdateCursor
      return emptySet !== latestSetEmpty || (!emptySet && latestUpdateCursor !== latestCursor)
    },
    subscribeToUpdates() {
      return map(subscribeToAccountEffects(horizonURL, accountID), () => fetchUpdate())
    }
  })
}

export const subscribeToOpenOrders = cachify(
  ordersSubscriptionCache,
  subscribeToOpenOrdersUncached,
  createAccountCacheKey
)

function createOrderbookQuery(selling: Asset, buying: Asset) {
  const query: any = { limit: 100 }

  query.buying_asset_type = buying.getAssetType()
  query.selling_asset_type = selling.getAssetType()

  if (!buying.isNative()) {
    query.buying_asset_code = buying.getCode()
    query.buying_asset_issuer = buying.getIssuer()
  }
  if (!selling.isNative()) {
    query.selling_asset_code = selling.getCode()
    query.selling_asset_issuer = selling.getIssuer()
  }

  return query
}

function createEmptyOrderbookRecord(base: Asset, counter: Asset): ServerApi.OrderbookRecord {
  return {
    _links: {
      self: {
        href: ""
      }
    },
    asks: [],
    bids: [],
    base,
    counter
  }
}

function subscribeToOrderbookUncached(horizonURL: string, sellingAsset: string, buyingAsset: string) {
  const buying = parseAssetID(buyingAsset)
  const selling = parseAssetID(sellingAsset)
  const query = createOrderbookQuery(selling, buying)

  if (selling.equals(buying)) {
    return Observable.from<ServerApi.OrderbookRecord>([createEmptyOrderbookRecord(buying, buying)])
  }

  const createURL = () => String(new URL(`/order_book?${qs.stringify({ ...query, cursor: "now" })}`, horizonURL))
  const fetchUpdate = () => fetchOrderbookRecord(horizonURL, sellingAsset, buyingAsset)

  let latestKnownSnapshot = ""

  // TODO: Optimize - Make UpdateT = ValueT & { [$snapshot]: string }

  return subscribeToUpdatesAndPoll({
    async applyUpdate(update) {
      latestKnownSnapshot = JSON.stringify(update)
      return update
    },
    fetchUpdate,
    async init() {
      const record = await fetchUpdate()
      latestKnownSnapshot = JSON.stringify(record)
      return record
    },
    shouldApplyUpdate(update) {
      const snapshot = JSON.stringify(update)
      return snapshot !== latestKnownSnapshot
    },
    subscribeToUpdates() {
      return new Observable<ServerApi.OrderbookRecord>(observer => {
        return createReconnectingSSE(createURL, {
          onMessage(message) {
            const record: ServerApi.OrderbookRecord = JSON.parse(message.data)
            observer.next(record)
          },
          onUnexpectedError(error) {
            observer.error(error)
          }
        })
      })
    }
  })
}

export const subscribeToOrderbook = cachify(
  orderbookSubscriptionCache,
  subscribeToOrderbookUncached,
  createOrderbookCacheKey
)

export interface PaginationOptions {
  cursor?: string
  limit?: number
  order?: "asc" | "desc"
}

export async function fetchAccountData(horizonURL: string, accountID: string) {
  const url = new URL(`/accounts/${accountID}?${qs.stringify(identification)}`, horizonURL)
  const response = await fetchQueue.add(() => fetch(String(url) + "?" + qs.stringify(identification)), { priority: 0 })

  if (response.status === 404) {
    return null
  }

  return parseJSONResponse<Horizon.AccountResponse>(response)
}

export async function fetchLatestAccountEffect(horizonURL: string, accountID: string) {
  const url = new URL(`/accounts/${accountID}/effects?${qs.stringify(identification)}`, horizonURL)
  const response = await fetchQueue.add(
    () =>
      fetch(
        String(url) +
          "?" +
          qs.stringify({
            ...identification,
            limit: 1,
            order: "desc"
          })
      ),
    { priority: 2 }
  )

  if (response.status === 404) {
    return null
  }

  return parseJSONResponse<ServerApi.EffectRecord>(response)
}

export interface FetchTransactionsOptions extends PaginationOptions {
  emptyOn404?: boolean
}

export async function fetchAccountTransactions(
  horizonURL: string,
  accountID: string,
  options: FetchTransactionsOptions = {}
): Promise<CollectionPage<Horizon.TransactionResponse>> {
  const url = new URL(`/accounts/${accountID}/transactions?${qs.stringify(identification)}`, horizonURL)
  const pagination = {
    cursor: options.cursor,
    limit: options.limit,
    order: options.order
  }
  const response = await fetchQueue.add(
    () => fetch(String(url) + "?" + qs.stringify({ ...identification, ...pagination })),
    { priority: 1 }
  )

  if (response.status === 404 && options.emptyOn404) {
    return {
      _links: {
        next: { href: String(url) },
        prev: { href: String(url) },
        self: { href: String(url) }
      },
      _embedded: {
        records: []
      }
    }
  }

  return parseJSONResponse<CollectionPage<Horizon.TransactionResponse>>(response)
}

export async function fetchAccountOpenOrders(horizonURL: string, accountID: string, options: PaginationOptions = {}) {
  const url = new URL(`/accounts/${accountID}/offers?${qs.stringify(identification)}`, horizonURL)
  const response = await fetchQueue.add(
    () => fetch(String(url) + "?" + qs.stringify({ ...identification, ...options })),
    { priority: 1 }
  )

  return parseJSONResponse<CollectionPage<ServerApi.OfferRecord>>(response)
}

export async function fetchOrderbookRecord(horizonURL: string, sellingAsset: string, buyingAsset: string) {
  if (buyingAsset === sellingAsset) {
    return createEmptyOrderbookRecord(parseAssetID(buyingAsset), parseAssetID(buyingAsset))
  }

  const query = createOrderbookQuery(parseAssetID(sellingAsset), parseAssetID(buyingAsset))
  const url = new URL(`/order_book?${qs.stringify({ ...identification, ...query })}`, horizonURL)
  const response = await fetchQueue.add(() => fetch(String(url)), { priority: 1 })
  return parseJSONResponse<ServerApi.OrderbookRecord>(response)
}
