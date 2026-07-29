import * as React from 'react'

import {
  subscribeLeanLoadingProgress,
  type LeanLoadingProgress,
} from './localWasmRpcClient'

const initialProgress: LeanLoadingProgress = {
  value: 0,
  message: 'Preparing Lean…',
}

export function useLeanLoadingProgress() {
  const [progress, setProgress] = React.useState(initialProgress)

  React.useEffect(
    () => subscribeLeanLoadingProgress(setProgress),
    [],
  )

  return progress
}
