"use client"

import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {

  const [isMobile, setIsMobile] =
    React.useState<boolean | undefined>(
      undefined
    )

  React.useEffect(() => {

    const mediaQuery =
      window.matchMedia(
        `(max-width: ${MOBILE_BREAKPOINT - 1}px)`
      )

    const updateMobileState = () => {

      setIsMobile(mediaQuery.matches)

    }

    // Initial check
    updateMobileState()

    // Listener
    mediaQuery.addEventListener(
      "change",
      updateMobileState
    )

    return () => {

      mediaQuery.removeEventListener(
        "change",
        updateMobileState
      )

    }

  }, [])

  return !!isMobile

}