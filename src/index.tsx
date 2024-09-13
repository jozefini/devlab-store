import {
  type FC,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from 'react'

export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }
  if (Array.isArray(obj)) {
    return obj.map(deepClone) as unknown as T
  }
  if (obj instanceof Map) {
    return new Map(
      Array.from(obj.entries()).map(([key, value]) => [
        deepClone(key),
        deepClone(value),
      ])
    ) as unknown as T
  }
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [key, deepClone(value)])
  ) as T
}

type NestedPartial<T> = {
  [K in keyof T]?: T[K] extends object ? NestedPartial<T[K]> : T[K]
}
type ConstructorProps<T> = {
  initialData?: NestedPartial<T>
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
  parentKeys: string[]
  parentPaths: string[]
  currentKey: string
}
type PropertyCache = {
  parentProp: any
  fallbackProp: any
  initialProp: any
}

class CreateStateStore<T> {
  // Data
  private data: T
  private initialData: T
  private fallbackData: T
  // Cache
  private pathCache = new Map<string, PathCache>()
  private propertyCache = new Map<string, PropertyCache>()
  private dependencyCache = new Map<string, Set<string>>()
  // Subscribers
  private subscribers: Map<string, Set<() => void>> = new Map()

  constructor({ initialData, fallbackData }: ConstructorProps<T>) {
    this.data = deepClone(initialData || {}) as T
    this.initialData = deepClone(initialData || {}) as T
    this.fallbackData = deepClone(fallbackData || {}) as T
  }

  // =====================
  // Subscribers
  // =====================

  private addSubscriber(path: string, callback: () => void) {
    if (!this.subscribers.has(path)) {
      this.subscribers.set(path, new Set())
    }
    this.subscribers.get(path)?.add(callback)
  }

  private removeSubscriber(path: string, callback: () => void) {
    const subscribers = this.subscribers.get(path)
    if (subscribers) {
      subscribers.delete(callback)
      if (subscribers.size === 0) {
        this.subscribers.delete(path)
      }
    }
  }

  private notifySubscribers(path: string) {
    const subscribers = this.subscribers.get(path)
    if (subscribers) {
      for (const callback of subscribers) {
        callback()
      }
    }
  }

  private notifyNestedSubscribers(path: string) {
    this.notifySubscribers(path)
    const { parentPaths } = this.getCachedPath(path)
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

  // =====================
  // Cached helpers
  // =====================

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

      const parentKeys = keys.slice(0, -1)
      const parentPaths = allPaths.length > 1 ? allPaths.slice(0, -1) : []
      const currentKey = keys[keys.length - 1] as string

      pathInfo = {
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
      const { parentKeys } = this.getCachedPath(path)

      let parentProp: any = this.data
      let fallbackProp: any = this.fallbackData
      let initialProp: any = this.initialData
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

  get<P extends Paths<T>>(path: P & string): PathValue<T, P> {
    const { currentKey } = this.getCachedPath(path)
    const { parentProp, fallbackProp } = this.getCachedProperty(path)
    const originalValue = (parentProp && parentProp[currentKey]) as PathValue<
      T,
      P
    >
    if (originalValue !== undefined) {
      return originalValue
    }
    return (fallbackProp && fallbackProp[currentKey]) as PathValue<T, P>
  }

  set<P extends Paths<T>>(
    path: P & string,
    value: PathValue<T, P>,
    notify: boolean = true
  ): void {
    const { currentKey, parentPaths } = this.getCachedPath(path)
    const { parentProp } = this.getCachedProperty(path)
    if (!parentProp) {
      let parent: Record<string, any> = this.data as Record<string, any>
      for (const parentKey of parentPaths) {
        if (parent[parentKey] === undefined) {
          parent[parentKey] = {}
        }
        parent = parent[parentKey]
      }
      parent[currentKey] = value
    } else {
      parentProp[currentKey] = value
    }

    if (notify) {
      this.notifyNestedSubscribers(path)
      this.notifyDependencies(path)
    }
  }

  update<P extends Paths<T>>(
    path: P & string,
    value: PathValue<T, P> | ((prev: PathValue<T, P>) => PathValue<T, P>),
    notify: boolean = true
  ): void {
    const { currentKey } = this.getCachedPath(path)
    const { parentProp } = this.getCachedProperty(path)
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
      this.notifyNestedSubscribers(path)
      this.notifyDependencies(path)
    }
  }

  remove<P extends Paths<T>>(path: P & string, notify: boolean = true): void {
    const { currentKey } = this.getCachedPath(path)
    const { parentProp } = this.getCachedProperty(path)
    if (!parentProp) {
      return
    }
    delete parentProp[currentKey]

    if (notify) {
      this.notifyNestedSubscribers(path)
      this.notifyDependencies(path)
    }
  }

  reset(notify: boolean = true): void {
    this.data = deepClone(this.initialData)

    if (notify) {
      this.subscribers.forEach((_, path) => {
        this.notifySubscribers(path)
      })
    }
  }

  // =====================
  // Reactive helpers
  // =====================

  use<P extends Paths<T>>(path: P & string): PathValue<T, P> {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const subscribe = useCallback(
      (callback: () => void) => {
        this.addSubscriber(path, callback)
        return () => this.removeSubscriber(path, callback)
      },
      [path]
    )
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const getSnapshot = useCallback(() => this.get(path), [path])
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  }
}

// =====================
// Global Store
// =====================
export function createStateStore<T>(props: ConstructorProps<T>) {
  return new CreateStateStore<T>(props)
}

// =====================
// Context Store
// =====================
export function createScopedStore<T>(props: ConstructorProps<T>) {
  const StoreContext = createContext<CreateStateStore<T> | null>(null)
  const Provider: FC<{ children: React.ReactNode }> = ({ children }) => {
    const store = useMemo(() => new CreateStateStore<T>(props), [])
    return (
      <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
    )
  }
  function useStore(): CreateStateStore<T> {
    const context = useContext(StoreContext)
    if (!context) {
      throw new Error('useStore must be used within a StoreProvider')
    }
    return context
  }
  return { Provider, useStore }
}
