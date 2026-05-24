"use client"

/* 
================================================
HOOK + TOAST SYSTEM
ARQUITECTURA PREMIUM · NEXT.JS · REACT 19 READY
================================================
Características:
✓ SSR Safe
✓ Optimizado para Next.js
✓ Tipado avanzado
✓ Toast variants
✓ toast.success()
✓ toast.error()
✓ toast.loading()
✓ toast.promise()
✓ dismiss individual/global
✓ queue system
✓ performance optimizada
✓ cleanup correcto
✓ architecture premium
================================================
*/

import * as React from "react"

import type {
  ToastActionElement,
  ToastProps,
} from "@/components/ui/toast"

/* =================================================
MOBILE HOOK
================================================= */

const MOBILE_BREAKPOINT = 768 as const

export function useIsMobile() {

  const [isMobile, setIsMobile] =
    React.useState(false)

  React.useEffect(() => {

    const mediaQuery =
      window.matchMedia(
        `(max-width: ${MOBILE_BREAKPOINT - 1}px)`
      )

    const handleChange = (
      event: MediaQueryListEvent
    ) => {

      setIsMobile(event.matches)

    }

    // Initial value
    setIsMobile(mediaQuery.matches)

    // Subscribe
    mediaQuery.addEventListener(
      "change",
      handleChange
    )

    // Cleanup
    return () => {

      mediaQuery.removeEventListener(
        "change",
        handleChange
      )

    }

  }, [])

  return isMobile

}

/* =================================================
TOAST CONFIG
================================================= */

const TOAST_LIMIT = 3

const TOAST_REMOVE_DELAY = 5000

/* =================================================
TYPES
================================================= */

type ToastVariant =
  | "default"
  | "success"
  | "error"
  | "warning"
  | "loading"

type ToasterToast = ToastProps & {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: ToastActionElement
  variant?: ToastVariant
}

type Toast = Omit<
  ToasterToast,
  "id"
>

interface ToastState {
  toasts: ToasterToast[]
}

type Action =
  | {
      type: "ADD_TOAST"
      toast: ToasterToast
    }

  | {
      type: "UPDATE_TOAST"
      toast: Partial<ToasterToast>
    }

  | {
      type: "DISMISS_TOAST"
      toastId?: string
    }

  | {
      type: "REMOVE_TOAST"
      toastId?: string
    }

/* =================================================
GLOBAL STORE
================================================= */

const listeners =
  new Set<
    (state: ToastState) => void
  >()

let memoryState: ToastState = {
  toasts: [],
}

/* =================================================
TIMEOUTS
================================================= */

const toastTimeouts =
  new Map<
    string,
    ReturnType<typeof setTimeout>
  >()

/* =================================================
UTILS
================================================= */

function generateId() {

  return crypto.randomUUID()

}

function notify() {

  listeners.forEach((listener) => {

    listener(memoryState)

  })

}

function addToRemoveQueue(
  toastId: string
) {

  if (
    toastTimeouts.has(toastId)
  ) {
    return
  }

  const timeout = setTimeout(() => {

    toastTimeouts.delete(
      toastId
    )

    dispatch({
      type: "REMOVE_TOAST",
      toastId,
    })

  }, TOAST_REMOVE_DELAY)

  toastTimeouts.set(
    toastId,
    timeout
  )

}

function clearToastTimeout(
  toastId: string
) {

  const timeout =
    toastTimeouts.get(toastId)

  if (timeout) {

    clearTimeout(timeout)

    toastTimeouts.delete(
      toastId
    )

  }

}

/* =================================================
REDUCER
================================================= */

function reducer(
  state: ToastState,
  action: Action
): ToastState {

  switch (action.type) {

    case "ADD_TOAST":

      return {
        ...state,

        toasts: [
          action.toast,
          ...state.toasts,
        ].slice(0, TOAST_LIMIT),
      }

    case "UPDATE_TOAST":

      return {
        ...state,

        toasts: state.toasts.map(
          (toast) =>

            toast.id ===
            action.toast.id

              ? {
                  ...toast,
                  ...action.toast,
                }

              : toast
        ),
      }

    case "DISMISS_TOAST": {

      const { toastId } =
        action

      if (toastId) {

        addToRemoveQueue(
          toastId
        )

      } else {

        state.toasts.forEach(
          (toast) => {

            addToRemoveQueue(
              toast.id
            )

          }
        )

      }

      return {
        ...state,

        toasts: state.toasts.map(
          (toast) =>

            toast.id === toastId ||
            toastId === undefined

              ? {
                  ...toast,
                  open: false,
                }

              : toast
        ),
      }

    }

    case "REMOVE_TOAST":

      if (
        action.toastId ===
        undefined
      ) {

        return {
          ...state,
          toasts: [],
        }

      }

      clearToastTimeout(
        action.toastId
      )

      return {
        ...state,

        toasts:
          state.toasts.filter(
            (toast) =>

              toast.id !==
              action.toastId
          ),
      }

    default:

      return state

  }

}

/* =================================================
DISPATCH
================================================= */

function dispatch(
  action: Action
) {

  memoryState = reducer(
    memoryState,
    action
  )

  notify()

}

/* =================================================
CORE TOAST
================================================= */

function createToast(
  props: Toast
) {

  const id = generateId()

  const dismiss = () => {

    dispatch({
      type: "DISMISS_TOAST",
      toastId: id,
    })

  }

  const update = (
    props: Partial<ToasterToast>
  ) => {

    dispatch({
      type: "UPDATE_TOAST",

      toast: {
        ...props,
        id,
      },
    })

  }

  dispatch({
    type: "ADD_TOAST",

    toast: {
      ...props,
      id,
      open: true,

      onOpenChange: (
        open
      ) => {

        if (!open) {

          dismiss()

        }

      },
    },
  })

  return {
    id,
    dismiss,
    update,
  }

}

/* =================================================
TOAST API
================================================= */

function toast(
  props: Toast
) {

  return createToast(props)

}

toast.success = (
  title: React.ReactNode,
  description?: React.ReactNode
) => {

  return createToast({
    title,
    description,
    variant: "success",
  })

}

toast.error = (
  title: React.ReactNode,
  description?: React.ReactNode
) => {

  return createToast({
    title,
    description,
    variant: "error",
  })

}

toast.warning = (
  title: React.ReactNode,
  description?: React.ReactNode
) => {

  return createToast({
    title,
    description,
    variant: "warning",
  })

}

toast.loading = (
  title: React.ReactNode,
  description?: React.ReactNode
) => {

  return createToast({
    title,
    description,
    variant: "loading",
  })

}

toast.dismiss = (
  toastId?: string
) => {

  dispatch({
    type: "DISMISS_TOAST",
    toastId,
  })

}

toast.remove = (
  toastId?: string
) => {

  dispatch({
    type: "REMOVE_TOAST",
    toastId,
  })

}

/* =================================================
PROMISE TOAST
================================================= */

toast.promise = async function <
  T
>(
  promise: Promise<T>,

  {
    loading,
    success,
    error,
  }: {
    loading: React.ReactNode

    success:
      | React.ReactNode
      | ((data: T) => React.ReactNode)

    error:
      | React.ReactNode
      | ((error: unknown) => React.ReactNode)
  }
) {

  const toastInstance =
    toast.loading(loading)

  try {

    const data =
      await promise

    toastInstance.update({
      title:
        typeof success ===
        "function"

          ? success(data)

          : success,

      variant: "success",

      open: true,
    })

    return data

  } catch (err) {

    toastInstance.update({
      title:
        typeof error ===
        "function"

          ? error(err)

          : error,

      variant: "error",

      open: true,
    })

    throw err

  }

}

/* =================================================
HOOK
================================================= */

export function useToast() {

  const [state, setState] =
    React.useState<ToastState>(
      memoryState
    )

  React.useEffect(() => {

    listeners.add(setState)

    return () => {

      listeners.delete(
        setState
      )

    }

  }, [])

  return {

    ...state,

    toast,

    dismiss:
      toast.dismiss,

    remove:
      toast.remove,
  }

}

/* =================================================
EXPORTS
================================================= */

export {
  toast,
}