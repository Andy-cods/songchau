import { useState, useEffect, useRef } from 'react'

interface AnimatedNumberProps {
  value: number
  formatter?: (n: number) => string
  duration?: number
}

export default function AnimatedNumber({ value, formatter, duration = 800 }: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState(0)
  const prevValue = useRef(0)

  useEffect(() => {
    const startValue = prevValue.current
    const startTime = performance.now()

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = Math.floor(startValue + (value - startValue) * eased)
      setDisplayValue(current)

      if (progress < 1) {
        requestAnimationFrame(animate)
      } else {
        prevValue.current = value
      }
    }

    requestAnimationFrame(animate)
  }, [value, duration])

  return <span>{formatter ? formatter(displayValue) : displayValue.toLocaleString()}</span>
}
