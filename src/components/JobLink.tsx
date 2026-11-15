// A job number that opens that job's page. Every screen that shows a job
// number uses this, so clicking one always lands on the job itself rather
// than on the list of all jobs.
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

export function jobPath(id: string | number) {
  return `/jobs/${encodeURIComponent(String(id))}`
}

export default function JobLink({ id, className = '', children }: {
  id: string | number | null | undefined
  className?: string
  children?: ReactNode
}) {
  if (id == null || id === '') return <>{children ?? '—'}</>
  return (
    <Link to={jobPath(id)} title="Open this job"
      // Rows that are clickable themselves must not also fire.
      onClick={e => e.stopPropagation()}
      className={`hover:underline ${className}`}>
      {children ?? String(id)}
    </Link>
  )
}
