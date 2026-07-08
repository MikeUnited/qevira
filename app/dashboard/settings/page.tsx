import Link from "next/link";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function DashboardSettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage your account and organization preferences.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/dashboard/settings/team" className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Card className="h-full transition-colors hover:bg-muted/40">
            <CardHeader>
              <CardTitle className="text-base">Team Management</CardTitle>
              <CardDescription>
                Invite members, roles, and access for your organization.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Card className="border-dashed opacity-70">
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">
              More settings
            </CardTitle>
            <CardDescription>Additional sections will appear here.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
