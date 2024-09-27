import {
  type FC,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from 'react'
import { deepClone } from './utils'

type NestedPartial<T> = {
  [K in keyof T]?: T[K] extends object ? NestedPartial<T[K]> : T[K]
}
type ConstructorProps<T> = {
  initialData?: Map<string, T>
  fallbackData?: NestedPartial<T>
}

type Join<K, P> = K extends string | number
  ? P extends string | number
    ? `${K}${'' extends P ? '' : '.'}${P}`
    : never
  : never
type Prev = [never, 0, 1, 2, 3]
type Paths<T, D extends number = 2> = [D] extends [never]
  ? never
  : T extends object
    ? {
        [K in keyof T]-?: K extends string | number
          ? `${K}` | Join<K, Paths<T[K], Prev[D]>>
          : never
      }[keyof T]
    : ''
type PathValue<T, P extends Paths<T>> = P extends `${infer Key}.${infer Rest}`
  ? Key extends keyof T
    ? Rest extends Paths<T[Key]>
      ? PathValue<T[Key], Rest>
      : never
    : never
  : P extends keyof T
    ? T[P]
    : never

type PathCache = {
  mapKey: string
  parentKeys: string[]
  parentPaths: string[]
  currentKey: string
}
type PropertyCache = {
  parentProp: any
  fallbackProp: any
  initialProp: any
}

class CreateMapStore<T> {
  // Data
  private data: Map<string, T>
  private initialData: Map<string, T>
  private fallbackData: T
  // Cache
  private pathCache = new Map<string, PathCache>()
  private propertyCache = new Map<string, PropertyCache>()
  private dependencyCache = new Map<string, Set<string>>()
  // Subscribers
  private subscribers: Map<string, Set<() => void>> = new Map()
  private keysSubscribers: Set<() => void> = new Set()
  private sizeSubscribers: Set<() => void> = new Set()
  // Keys
  private cachedKeys: string[] = []

  constructor({ initialData, fallbackData }: ConstructorProps<T>) {
    this.data =
      (deepClone(initialData) as unknown as Map<string, T>) || new Map()
    this.initialData =
      (deepClone(initialData) as unknown as Map<string, T>) || new Map()
    this.fallbackData = deepClone(fallbackData || {}) as T
    this.notifyCountSubscribers()
  }

  // =====================
  // Subscribers
  // =====================

  private notifySubscribers(path: string) {
    const subscribers = this.subscribers.get(path)
    if (subscribers) {
      for (const callback of subscribers) {
        callback()
      }
    }
  }

  private notifyNestedSubscribers(path: string) {
    const { parentPaths, mapKey } = this.getCachedPath(path)
    if (mapKey === path) {
      this.notifySubscribers(mapKey)
    } else {
      this.notifySubscribers(path)
    }
    for (const parentPath of parentPaths) {
      this.notifySubscribers(parentPath)
    }
  }

  private notifyDependencies(path: string) {
    const dependencySet = this.dependencyCache.get(path)
    if (dependencySet) {
      for (const dependency of dependencySet) {
        this.notifySubscribers(dependency)
      }
    }
  }

  private notifyCountSubscribers() {
    this.cachedKeys = Array.from(this.data.keys())
    for (const callback of this.keysSubscribers) {
      callback()
    }
    for (const callback of this.sizeSubscribers) {
      callback()
    }
  }

  // =====================
  // Cached helpers
  // =====================

  private getFullPath(key: string, path = '') {
    return `${key}${path ? `.${path}` : ''}`
  }

  private getCachedPath(path: string, flush = false) {
    let pathInfo = this.pathCache.get(path)

    if (!pathInfo || flush) {
      const keys = path.split('.')
      const allPaths = keys.reduce((acc, key, index) => {
        if (index === 0) {
          acc.push(key)
        } else {
          acc.push(`${acc[index - 1]}.${key}`)
        }
        return acc
      }, [] as string[])

      const mapKey = keys[0] as string
      const parentKeys = keys.slice(1, -1)
      const parentPaths = allPaths.length > 1 ? allPaths.slice(0, -1) : []
      const currentKey =
        keys.length === 1 ? '' : (keys[keys.length - 1] as string)

      pathInfo = {
        mapKey,
        parentKeys,
        parentPaths,
        currentKey,
      }

      this.pathCache.set(path, pathInfo)

      if (parentPaths.length > 0) {
        for (const parentPath of parentPaths) {
          if (!this.dependencyCache.has(parentPath)) {
            this.dependencyCache.set(parentPath, new Set())
          }
          const dependencies = this.dependencyCache.get(parentPath)
          if (dependencies) {
            dependencies.add(path)
          }
        }
      }
    }

    return pathInfo
  }

  private getCachedProperty(path: string, flush = false) {
    let propInfo = this.propertyCache.get(path)

    if (!propInfo || flush) {
      const { parentKeys, mapKey } = this.getCachedPath(path)
      let parentProp: any = this.data.get(mapKey)
      let initialProp: any = this.initialData.get(mapKey)
      let fallbackProp: any = this.fallbackData

      for (const parentKey of parentKeys) {
        if (parentProp !== undefined && parentProp !== null) {
          parentProp = parentProp[parentKey]
        } else {
          parentProp = undefined
          break
        }
        if (fallbackProp !== undefined && fallbackProp !== null) {
          fallbackProp = fallbackProp[parentKey]
        }
        if (initialProp !== undefined && initialProp !== null) {
          initialProp = initialProp[parentKey]
        }
      }

      propInfo = {
        parentProp,
        fallbackProp,
        initialProp,
      }
    }

    return propInfo
  }

  // =====================
  // Getters and Setters
  // =====================

  key(mapKey: string) {
    return {
      get: <P extends Paths<T>>(path?: P): PathValue<T, P> => {
        return this.get(mapKey, path)
      },
      set: (value: T, notify: boolean = true): void => {
        this.set(mapKey, value, notify)
      },
      update: <P extends Paths<T>>(
        path: P,
        value: PathValue<T, P> | ((prev: PathValue<T, P>) => PathValue<T, P>),
        notify: boolean = true
      ): void => {
        this.update(mapKey, path, value, notify)
      },
      use: <P extends Paths<T>>(path?: P): PathValue<T, P> => {
        return this.use(mapKey, path)
      },
      remove: (notify: boolean = true): void => {
        this.remove(mapKey, notify)
      },
    }
  }

  getKeys() {
    return Array.from(this.data.keys())
  }

  getSize() {
    return this.data.size
  }

  useKeys(): string[] {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const subscribe = useCallback((callback: () => void) => {
      this.keysSubscribers.add(callback)
      return () => {
        this.keysSubscribers.delete(callback)
      }
    }, [])
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const getSnapshot = useCallback(() => this.cachedKeys, [])
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  }

  useSize(): number {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const subscribe = useCallback((callback: () => void) => {
      this.sizeSubscribers.add(callback)
      return () => {
        this.sizeSubscribers.delete(callback)
      }
    }, [])
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const getSnapshot = useCallback(() => this.getSize(), [])
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  }

  reset(notify: boolean = true): void {
    this.data = deepClone(this.initialData)

    if (notify) {
      this.subscribers.forEach((_, path) => {
        this.notifySubscribers(path)
      })
      this.notifyCountSubscribers()
    }
  }

  clear(notify: boolean = true): void {
    this.data.clear()

    if (notify) {
      this.subscribers.forEach((_, path) => {
        this.notifySubscribers(path)
      })
      this.notifyCountSubscribers()
    }
  }

  private get<P extends Paths<T>>(mapKey: string, path?: P): PathValue<T, P> {
    const fullPath = this.getFullPath(mapKey, path)
    const { currentKey } = this.getCachedPath(fullPath)
    const { fallbackProp, parentProp } = this.getCachedProperty(fullPath)
    const originalValue = currentKey
      ? parentProp && parentProp[currentKey]
      : (parentProp as PathValue<T, P>)

    if (originalValue !== undefined) {
      return originalValue
    }
    return (fallbackProp && fallbackProp[currentKey]) as PathValue<T, P>
  }

  private set(mapKey: string, value: T, notify: boolean = true): void {
    const hasKey = this.data.has(mapKey)

    const fullPath = this.getFullPath(mapKey)
    this.data.set(mapKey, value)

    if (notify) {
      this.notifyNestedSubscribers(fullPath)
      this.notifyDependencies(fullPath)
    }
    if (!hasKey) {
      this.notifyCountSubscribers()
    }
  }

  private update<P extends Paths<T>>(
    mapKey: string,
    path: P,
    value: PathValue<T, P> | ((prev: PathValue<T, P>) => PathValue<T, P>),
    notify: boolean = true
  ): void {
    if (!this.data.has(mapKey)) {
      return
    }

    const fullPath = this.getFullPath(mapKey, path)
    const { currentKey } = this.getCachedPath(fullPath)
    const { parentProp } = this.getCachedProperty(fullPath)
    if (!parentProp) {
      return
    }

    if (typeof value === 'function') {
      parentProp[currentKey] = (
        value as (prev: PathValue<T, P>) => PathValue<T, P>
      )(parentProp[currentKey])
    } else {
      parentProp[currentKey] = value
    }

    if (notify) {
      this.notifyNestedSubscribers(fullPath)
      this.notifyDependencies(fullPath)
    }
  }

  private remove(mapKey: string, notify: boolean = true): void {
    if (!this.data.has(mapKey)) {
      return
    }
    this.data.delete(mapKey)

    if (notify) {
      this.notifyNestedSubscribers(mapKey)
      this.notifyDependencies(mapKey)
      this.notifyCountSubscribers()
    }
  }

  private use<P extends Paths<T>>(mapKey: string, path?: P): PathValue<T, P> {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const subscribe = useCallback(
      (callback: () => void) => {
        const fullPath = this.getFullPath(mapKey, path)
        if (!this.subscribers.has(fullPath)) {
          this.subscribers.set(fullPath, new Set())
        }
        this.subscribers.get(fullPath)?.add(callback)

        return () => {
          const subscribers = this.subscribers.get(fullPath)
          if (subscribers) {
            subscribers.delete(callback)
            if (subscribers.size === 0) {
              this.subscribers.delete(fullPath)
            }
          }
        }
      },
      [mapKey, path]
    )
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const getSnapshot = useCallback(
      () => this.get(mapKey, path),
      [mapKey, path]
    )
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  }
}

// =====================
// Instance Type
// =====================
export type MapStoreInstance<T> = CreateMapStore<T>

// =====================
// Global Store
// =====================
export function createMapStore<T>(props: ConstructorProps<T>) {
  return new CreateMapStore<T>(props)
}

// =====================
// Context Store
// =====================
export function createScopedMapStore<T>(props: ConstructorProps<T>) {
  const StoreContext = createContext<CreateMapStore<T> | null>(null)
  const Provider: FC<{ children: React.ReactNode }> = ({ children }) => {
    const store = useMemo(() => new CreateMapStore<T>(props), [])
    return (
      <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
    )
  }
  function useStore(): CreateMapStore<T> {
    const context = useContext(StoreContext)
    if (!context) {
      throw new Error('useStore must be used within a StoreProvider')
    }
    return context
  }
  return { Provider, useStore }
}
