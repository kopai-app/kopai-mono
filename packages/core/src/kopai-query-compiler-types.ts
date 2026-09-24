/** One problem with a query, at a dotted path; `""` is the query as a whole. */
export interface KopaiQueryIssue {
  path: string;
  message: string;
}
