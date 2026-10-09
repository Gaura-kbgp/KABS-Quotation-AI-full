import { requireSuperAdmin } from '@/lib/auth';
import { getUsageOverview, EVENT_LABEL } from '@/features/usage/data';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { Activity } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function eventLabel(t: string) {
  return EVENT_LABEL[t] || t;
}

export default async function UsagePage() {
  await requireSuperAdmin();
  const { recent, byClient, byUser, windowSize, windowCapped } = await getUsageOverview();

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Tool Usage</h1>
        <p className="text-slate-500 mt-1">
          Who used which tool, across every client{windowCapped ? ` (most recent ${windowSize.toLocaleString()} events)` : ''}.
        </p>
      </div>

      {windowSize === 0 && (
        <Card className="border-slate-200 border-dashed">
          <CardContent className="py-12 text-center text-slate-400">
            <Activity className="w-8 h-8 mx-auto mb-3" />
            No activity logged yet. Usage appears here as clients upload files and generate quotes.
          </CardContent>
        </Card>
      )}

      {windowSize > 0 && (
        <>
          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="text-base">By client</CardTitle>
              <CardDescription>Tool usage per company, most active first.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead className="text-right">Total actions</TableHead>
                    <TableHead>Breakdown</TableHead>
                    <TableHead className="text-right">Last activity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byClient.map((c) => (
                    <TableRow key={c.org_id}>
                      <TableCell className="font-medium">{c.org_name}</TableCell>
                      <TableCell className="text-right font-bold">{c.total}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(c.byType).map(([type, count]) => (
                            <Badge key={type} variant="outline" className="font-normal">
                              {eventLabel(type)}: {count}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-slate-400 text-sm">
                        {c.lastActivity ? formatDistanceToNow(new Date(c.lastActivity), { addSuffix: true }) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="text-base">By user</CardTitle>
              <CardDescription>Which user used which tool, and how often.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead className="text-right">Total actions</TableHead>
                    <TableHead>Breakdown</TableHead>
                    <TableHead className="text-right">Last activity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byUser.map((u) => (
                    <TableRow key={u.actor_email}>
                      <TableCell className="font-medium">{u.actor_email}</TableCell>
                      <TableCell className="text-slate-500">{u.org_name || '—'}</TableCell>
                      <TableCell className="text-right font-bold">{u.total}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(u.byType).map(([type, count]) => (
                            <Badge key={type} variant="outline" className="font-normal">
                              {eventLabel(type)}: {count}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-slate-400 text-sm">
                        {u.lastActivity ? formatDistanceToNow(new Date(u.lastActivity), { addSuffix: true }) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="text-base">Recent activity</CardTitle>
              <CardDescription>Latest 50 tool-usage events across all clients.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {recent.map((e) => (
                <div key={e.id} className="flex items-center justify-between text-sm border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                  <span className="text-slate-700">
                    <span className="font-medium">{eventLabel(e.event_type)}</span>
                    {e.org_name && <> — {e.org_name}</>}
                  </span>
                  <span className="text-slate-400 text-xs shrink-0 ml-4">
                    {e.actor_email || 'unknown'} · {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
