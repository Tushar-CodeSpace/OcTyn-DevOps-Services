import { useEffect, useState } from "react";
import { Crown, KeyRound, Trash2, UserPlus, Users as UsersIcon } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { showToast } from "@/components/ToastHost";
import type { Role, User } from "@/lib/types";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export default function UsersPage() {
  const { user: currentUser, isAdmin, isSuperAdmin: currentUserIsSuperAdmin } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({
    email: "",
    password: "",
    name: "",
    role: "viewer" as Role,
  });
  const [creatingUser, setCreatingUser] = useState(false);

  useEffect(() => {
    if (isAdmin) {
      fetchUsers();
    }
  }, [isAdmin]);

  function fetchUsers() {
    setUsersLoading(true);
    apiFetch<User[]>("/users")
      .then(setUsers)
      .catch((err) =>
        showToast({
          severity: "critical",
          title: "Failed to load users",
          message: err instanceof Error ? err.message : undefined,
        })
      )
      .finally(() => setUsersLoading(false));
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newUser.email || !newUser.password) return;
    setCreatingUser(true);
    try {
      const created = await apiFetch<User>("/users", {
        method: "POST",
        body: JSON.stringify(newUser),
      });
      setUsers((prev) => [...prev, created]);
      setShowAddUser(false);
      setNewUser({ email: "", password: "", name: "", role: "viewer" });
      showToast({
        severity: "info",
        title: "User created",
        message: `Account ${created.email} (${created.role}) created successfully.`,
      });
    } catch (err) {
      showToast({
        severity: "critical",
        title: "Create user failed",
        message: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setCreatingUser(false);
    }
  }

  async function handleRoleChange(userId: string, newRole: Role) {
    try {
      const updated = await apiFetch<User>(`/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role: newRole }),
      });
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
      showToast({
        severity: "info",
        title: "Role updated",
        message: `Role changed to ${newRole}.`,
      });
    } catch (err) {
      showToast({
        severity: "critical",
        title: "Role update failed",
        message: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function handleAdminResetPassword(userId: string, email: string) {
    const newPass = prompt(`Enter new password for user ${email} (minimum 8 characters):`);
    if (!newPass) return;
    if (newPass.length < 8) {
      showToast({
        severity: "critical",
        title: "Password Too Short",
        message: "Password must be at least 8 characters long.",
      });
      return;
    }
    try {
      await apiFetch(`/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ password: newPass }),
      });
      showToast({
        severity: "info",
        title: "Password Reset",
        message: `Password updated for ${email}.`,
      });
    } catch (err) {
      showToast({
        severity: "critical",
        title: "Password Reset Failed",
        message: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function handleDeleteUser(userId: string, email: string) {
    if (!confirm(`Are you sure you want to delete user ${email}?`)) return;
    try {
      await apiFetch(`/users/${userId}`, { method: "DELETE" });
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      showToast({
        severity: "info",
        title: "User deleted",
        message: `Account ${email} removed.`,
      });
    } catch (err) {
      showToast({
        severity: "critical",
        title: "Delete user failed",
        message: err instanceof Error ? err.message : undefined,
      });
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <h2 className="text-xl font-bold text-red-400">Access Restricted</h2>
        <p className="mt-1 text-sm text-slate-400">User Management is restricted to Admin accounts.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">User Management & Roles</h1>
        <p className="text-sm text-slate-400">Manage monitoring user accounts and permissions</p>
      </div>

      <Card className="max-w-4xl border-emerald-500/30 bg-slate-900/80">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <UsersIcon className="h-4 w-4 text-emerald-400" />
              Platform Accounts ({users.length})
            </CardTitle>
            <p className="text-xs text-slate-400">
              Add new monitoring accounts and assign permissions (<code className="text-emerald-400">admin</code> or <code className="text-slate-400">viewer</code>).
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setShowAddUser(!showAddUser)}
            className="bg-emerald-600 text-white hover:bg-emerald-500"
          >
            <UserPlus className="mr-1.5 h-3.5 w-3.5" />
            Add User
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {showAddUser && (
            <form
              onSubmit={handleCreateUser}
              className="flex flex-col gap-3 rounded-xl border border-slate-700/80 bg-slate-950/60 p-4"
            >
              <h4 className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                New User Registration
              </h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-slate-400">Email Address *</Label>
                  <Input
                    type="email"
                    required
                    placeholder="user@company.com"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-slate-400">Password *</Label>
                  <Input
                    type="password"
                    required
                    minLength={8}
                    placeholder="At least 8 characters"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-slate-400">Full Name</Label>
                  <Input
                    placeholder="Jane Doe"
                    value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-slate-400">Role *</Label>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value as Role })}
                    className="h-9 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-xs text-slate-200 outline-none focus:border-emerald-500"
                  >
                    <option value="viewer">Viewer (Read-only)</option>
                    <option value="admin">Admin (Operational Control)</option>
                  </select>
                </div>
              </div>
              <div className="mt-1 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAddUser(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={creatingUser}>
                  {creatingUser ? "Saving…" : "Create User"}
                </Button>
              </div>
            </form>
          )}

          {usersLoading ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="pb-2 font-medium">User</th>
                    <th className="pb-2 font-medium">Role</th>
                    <th className="pb-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {users
                    .filter((u) => currentUserIsSuperAdmin || String(u.role).toLowerCase() !== "super_admin")
                    .map((u) => {
                      const isSelf = currentUser?.id === u.id;
                      const isSuperAdmin = String(u.role).toLowerCase() === "super_admin";
                      const initials = (u.name || u.email).slice(0, 2).toUpperCase();
                      return (
                        <tr key={u.id} className="group transition-colors hover:bg-slate-800/40">
                          <td className="py-2.5">
                            <div className="flex items-center gap-2.5">
                              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-gradient-to-br from-emerald-500/20 to-sky-500/20 text-[10px] font-bold text-emerald-300 shadow-inner">
                                {initials}
                              </div>
                              <div>
                                <div className="font-medium text-slate-200">{u.email}</div>
                                {u.name && <div className="text-[11px] text-slate-400">{u.name}</div>}
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5">
                            {String(u.role).toLowerCase() === "super_admin" ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-gradient-to-r from-amber-500/20 to-orange-500/20 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-300 ring-1 ring-amber-500/40 shadow-sm shadow-amber-500/20">
                                <Crown className="h-3 w-3 text-amber-400 animate-pulse" />
                                super_admin
                              </span>
                            ) : (
                              <select
                                value={u.role}
                                disabled={isSelf}
                                onChange={(e) => handleRoleChange(u.id, e.target.value as Role)}
                                className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-xs text-slate-300 outline-none focus:border-emerald-500 disabled:opacity-50"
                              >
                                <option value="viewer">viewer</option>
                                <option value="admin">admin</option>
                                {currentUserIsSuperAdmin && <option value="super_admin">super_admin</option>}
                              </select>
                            )}
                          </td>
                          <td className="py-2.5 text-right flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              title={`Reset password for ${u.email}`}
                              onClick={() => handleAdminResetPassword(u.id, u.email)}
                              className="h-7 w-7 text-slate-500 hover:text-sky-400"
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={isSelf || isSuperAdmin}
                              title={isSelf ? "Cannot delete your own account" : isSuperAdmin ? "Cannot delete a super admin" : "Delete user"}
                              onClick={() => handleDeleteUser(u.id, u.email)}
                              className="h-7 w-7 text-slate-500 hover:text-red-400 disabled:opacity-30"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
