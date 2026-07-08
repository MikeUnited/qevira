"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type MemberRow = {
  id: string;
  email: string;
  role: string;
  status: string;
  invitedBy: string;
  createdAt: string;
};

function statusBadge(status: string) {
  switch (status) {
    case "PENDING":
      return (
        <Badge className="border-0 bg-amber-500 text-white hover:bg-amber-500">
          Pending
        </Badge>
      );
    case "ACCEPTED":
      return (
        <Badge className="border-0 bg-emerald-600 text-white hover:bg-emerald-600">
          Active
        </Badge>
      );
    case "REVOKED":
      return (
        <Badge variant="destructive" className="border-0">
          Revoked
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function roleBadge(role: string) {
  switch (role) {
    case "OWNER":
      return (
        <Badge className="border-0 bg-primary text-primary-foreground hover:bg-primary">
          Owner
        </Badge>
      );
    case "DIRECTOR":
      return (
        <Badge className="border-0 bg-purple-600 text-white hover:bg-purple-600">
          Director
        </Badge>
      );
    case "PHARMACIST":
      return (
        <Badge className="border-0 bg-zinc-500 text-white hover:bg-zinc-500">
          Pharmacist
        </Badge>
      );
    default:
      return <Badge variant="outline">{role}</Badge>;
  }
}

export default function TeamSettingsPage() {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamRole, setTeamRole] = useState<string | undefined>();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"DIRECTOR" | "PHARMACIST">(
    "PHARMACIST"
  );
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/team/members", { credentials: "include" });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          data &&
            typeof data === "object" &&
            data !== null &&
            "error" in data &&
            typeof (data as { error?: string }).error === "string"
            ? (data as { error: string }).error
            : `Failed (${res.status})`
        );
      }
      setMembers(Array.isArray(data) ? (data as MemberRow[]) : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load members.");
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/user/profile", { credentials: "include" });
        const data = (await res.json().catch(() => ({}))) as {
          teamRole?: string;
        };
        if (res.ok && typeof data.teamRole === "string") {
          setTeamRole(data.teamRole);
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const canInvite = teamRole === "OWNER" || teamRole === "DIRECTOR";

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteSubmitting(true);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: inviteEmail.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          role: inviteRole,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" && data.error.trim()
            ? data.error
            : `Request failed (${res.status})`
        );
      }
      toast.success(
        typeof data.message === "string" ? data.message : "Invitation sent."
      );
      setInviteOpen(false);
      setFirstName("");
      setLastName("");
      setInviteEmail("");
      setInviteRole("PHARMACIST");
      await loadMembers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invite failed.");
    } finally {
      setInviteSubmitting(false);
    }
  }

  function canRevokeRow(row: MemberRow): boolean {
    if (row.role === "OWNER") return false;
    if (row.status === "REVOKED") return false;
    if (teamRole === "OWNER") return true;
    if (teamRole === "DIRECTOR" && row.role === "PHARMACIST") return true;
    return false;
  }

  async function revokeMember(id: string) {
    if (
      !confirm(
        "Revoke this team member? They will no longer have access to this organization."
      )
    ) {
      return;
    }
    setRevokeId(id);
    try {
      const res = await fetch("/api/team/members", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ memberId: id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" && data.error.trim()
            ? data.error
            : `Request failed (${res.status})`
        );
      }
      toast.success("Member revoked.");
      await loadMembers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not revoke.");
    } finally {
      setRevokeId(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team Management</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage your organization&apos;s team members
        </p>
      </div>

      {canInvite && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-lg">Invite</CardTitle>
              <CardDescription>
                Invite directors or pharmacists by email.
              </CardDescription>
            </div>
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
              <DialogTrigger asChild>
                <Button type="button">Invite Team Member</Button>
              </DialogTrigger>
              <DialogContent>
                <form onSubmit={submitInvite}>
                  <DialogHeader>
                    <DialogTitle>Invite team member</DialogTitle>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <Label htmlFor="inv-fn">First name</Label>
                      <Input
                        id="inv-fn"
                        required
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="inv-ln">Last name</Label>
                      <Input
                        id="inv-ln"
                        required
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="inv-em">Email</Label>
                      <Input
                        id="inv-em"
                        type="email"
                        required
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Role</Label>
                      <Select
                        value={inviteRole}
                        onValueChange={(v) =>
                          setInviteRole(v as "DIRECTOR" | "PHARMACIST")
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {teamRole === "OWNER" && (
                            <SelectItem value="DIRECTOR">Director</SelectItem>
                          )}
                          <SelectItem value="PHARMACIST">Pharmacist</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={inviteSubmitting}>
                      {inviteSubmitting ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          Sending…
                        </>
                      ) : (
                        "Send invitation"
                      )}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Members</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="text-muted-foreground size-8 animate-spin" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Invited by</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-sm">{m.email}</TableCell>
                    <TableCell>{roleBadge(m.role)}</TableCell>
                    <TableCell>{statusBadge(m.status)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {m.invitedBy || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {canRevokeRow(m) ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={revokeId === m.id}
                          onClick={() => void revokeMember(m.id)}
                        >
                          Revoke
                        </Button>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
