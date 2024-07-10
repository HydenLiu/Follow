import { appLog } from "@renderer/lib/log"
import { sleep } from "@renderer/lib/utils"
import type { CombinedEntryModel, FeedModel } from "@renderer/models"
import {
  EntryRelatedKey,
  EntryRelatedService,
  EntryService,
  FeedService,
  FeedUnreadService,
  SubscriptionService,
} from "@renderer/services"

import { entryActions, useEntryStore } from "../entry/store"
import { feedActions, useFeedStore } from "../feed"
import { subscriptionActions } from "../subscription"
import { feedUnreadActions } from "../unread"

// This flag controls write data in indexedDB, if it's false, pass data insert to db
// When app not ready, it's false, after hydrate data, it's true
// Or set is false when disable indexedDB in setting
let _isHydrated = false

export const setHydrated = (v: boolean) => {
  _isHydrated = v
}

export const isHydrated = () => _isHydrated

export const hydrateDatabaseToStore = async () => {
  appLog("Hydrate database data to store task start...")

  async function hydrate() {
    const now = Date.now()
    const [feeds] = await Promise.all([
      hydrateFeed(),
      hydrateSubscription(),
      hydrateFeedUnread(),
    ])

    await hydrateEntry(feeds)
    _isHydrated = true
    appLog("Hydrate data done,", `${Date.now() - now}ms`)
  }
  await Promise.race([hydrate(), sleep(1000).then(() => "timeout")]).then(
    (result) => {
      if (result === "timeout") {
        appLog("Hydrate data timeout")
      }
    },
  )
}

async function hydrateFeed() {
  const feeds = await FeedService.findAll()
  feedActions.upsertMany(feeds)
  return useFeedStore.getState().feeds
}

async function hydrateFeedUnread() {
  const unread = await FeedUnreadService.getAll()

  return feedUnreadActions.hydrate(unread)
}
async function hydrateEntry(feedMap: Record<string, FeedModel>) {
  const [entries, entryRelated, feedEntries, collections] = await Promise.all([
    EntryService.findAll(),

    EntryRelatedService.findAll(EntryRelatedKey.READ),
    EntryRelatedService.findAll(EntryRelatedKey.FEED_ID),
    EntryRelatedService.findAll(EntryRelatedKey.COLLECTION),
  ])

  const storeValue = [] as CombinedEntryModel[]
  for (const entry of entries) {
    const entryRelatedFeedId = feedEntries[entry.id]
    if (!entryRelatedFeedId) {
      logHydrateError(`Entry ${entry.id} has no related feed id`)
      continue
    }
    const feed = feedMap[entryRelatedFeedId]

    if (!feed) {
      logHydrateError(`Entry related feed ${entryRelatedFeedId} is missing`)
      continue
    }

    storeValue.push({
      entries: entry,
      // @ts-expect-error
      // FIXME server provided feed type is not match, but it's ok
      feeds: feed,
      read: entryRelated[entry.id] || false,
      collections: collections[entry.id],
    })
  }
  entryActions.upsertMany(storeValue)
  useEntryStore.setState({
    starIds: new Set(Object.keys(collections)),
  })
}

async function hydrateSubscription() {
  const subscriptions = await SubscriptionService.findAll()

  subscriptionActions.upsertMany(subscriptions)
}

const logHydrateError = (message: string) => {
  // eslint-disable-next-line no-console
  console.debug(
    `Hydrate error: ${message}, maybe local database data is dirty.`,
  )
}
