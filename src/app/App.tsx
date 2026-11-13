import { isDemo } from '../lib/supabase'
import { DemoApp } from './DemoApp'
import { RealApp } from '../real/RealApp'

/**
 * Two ways to run:
 *  - no Supabase settings  -> the click-through sample with made-up people
 *  - Supabase settings set -> the real app, with real accounts and saved data
 */
export function App() {
  return isDemo ? <DemoApp /> : <RealApp />
}
