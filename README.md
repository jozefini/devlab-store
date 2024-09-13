# State Management Store Knowledge Base

## Overview

This is a custom state management store for React applications. It provides both global and context-based state management with features like deep access, updates, and subscriptions.

## Key Features

1.  Global and context-based store creation
2.  Non-subscribed helpers (get, set, update, remove, reset)
3.  Subscribed helper (use)
4.  Deep access to nested properties
5.  Deep updates of nested properties
6.  Deep subscribed state for nested properties

## Detailed Feature Explanation

### 1. Store Creation

## Global Store

```typescript
import { createStore } from '@devlab/store'

const globalStore = createStore<{
  user: { name: string; age: number }
  settings: { theme: string }
}>({
  initialData: {
    user: { name: 'John', age: 30 },
    settings: { theme: 'light' },
  },
  fallbackData: {
    user: { name: 'Guest', age: 0 },
    settings: { theme: 'default' },
  },
})
```

## Context Store

```typescript
import { createScopedStore } from '@devlab/store';

const { Provider, useStore } = createScopedStore<{
  user: { name: string; age: number };
  settings: { theme: string };
}>({
  initialData: {
    user: { name: 'John', age: 30 },
    settings: { theme: 'light' },
  },
  fallbackData: {
    user: { name: 'Guest', age: 0 },
    settings: { theme: 'default' },
  },
});

// Usage in app:

function App() {
  return (
    <Provider>
      <YourComponents />
    </Provider>
  );
}

// Usage in components:

function YourComponent() {
  const store = useStore();
  // Use the store...
}
```

### 2. Non-subscribed Helpers

## get

Retrieves a value from the store.

typescript

Copy

`const userName = globalStore.get('user.name') // userName is 'John'`

## set

Sets a value in the store.

```typescript
globalStore.set('user.name', 'Jane') // user.name is now 'Jane'
```

## update

Updates a value in the store using the current value.

```typescript
globalStore.update('user.age', (prevAge) => prevAge + 1) // user.age is now 31
```

## remove

Removes a value from the store.

```typescript
globalStore.remove('user.age') // user.age is now undefined
```

## reset

Resets the entire store to its initial state.

```typescript
globalStore.reset() // Store is reset to initial values
```

### 3. Subscribed Helper

## use

Creates a reactive subscription to a specific path in the store.

```typescript
function UserName() {
  const userName = globalStore.use('user.name');
  return <div>{userName}</div>;
}
```

### 4. Deep Access

Access nested properties using dot notation.

```typescript
const theme = globalStore.get('settings.theme') // theme is 'light'
```

### 5. Deep Update

Update nested properties using dot notation.

```typescript
globalStore.set('settings.theme', 'dark') // settings.theme is now 'dark'
globalStore.update('user', (prevUser) => ({
  ...prevUser,
  age: prevUser.age + 1,
})) // user.age is now incremented
```

### 6. Deep Subscribed State

Create reactive subscriptions to deeply nested properties.

```typescript
function UserAge() {
  const userAge = globalStore.use('user.age');
  return <div>Age: {userAge}</div>;
} // Component re-renders when user.age changes
```

## Usage Tips

- Use dot notation for accessing and updating nested properties.
- The `use` method automatically creates reactive subscriptions.
- The store supports both simple and complex state structures.
- Always use the appropriate helper method for your use case (`get` for reading, `set`/`update` for writing).
- The context store provides a way to scope state to a specific part of your component tree.
