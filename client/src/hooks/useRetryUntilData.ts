import * as React from 'react'

type RetryingQueryResult<T> = {
  data?: T
  isLoading: boolean
  isFetching?: boolean
  refetch: () => unknown
}

export function useRetryUntilData<T>(
  query: RetryingQueryResult<T>,
  retryDelayMs = 1000,
) {
  React.useEffect(() => {
    if (query.data !== undefined || query.isLoading || query.isFetching) return

    const timeoutId = window.setTimeout(() => {
      void query.refetch()
    }, retryDelayMs)

    return () => window.clearTimeout(timeoutId)
  }, [query.data, query.isLoading, query.isFetching, query.refetch, retryDelayMs])
}
