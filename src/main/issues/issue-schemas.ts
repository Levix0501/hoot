import { z } from 'zod'
import {
  ISSUE_DESCRIPTION_MAX_LENGTH,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  ISSUE_TITLE_MAX_LENGTH,
} from '../../shared/issues'

/**
 * What the main process accepts for an issue's fields, from the window and
 * from hoot alike: no longer than Hoot saves, and only the statuses and
 * priorities there are.
 */
export const issueTitle = z.string().max(ISSUE_TITLE_MAX_LENGTH)
export const issueDescription = z.string().max(ISSUE_DESCRIPTION_MAX_LENGTH)
export const issueStatus = z.enum(ISSUE_STATUSES)
export const issuePriority = z.literal(ISSUE_PRIORITIES)
