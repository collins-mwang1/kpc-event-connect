import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  addDepartmentMember,
  createDepartment,
  deleteDepartment,
  listDepartmentMembers,
  listDepartments,
  removeDepartmentMember,
  searchPeopleForAssignment,
  updateDepartment,
  type DepartmentSummary,
} from "@/lib/departments.functions";
import { listSpaceFields } from "@/lib/segments.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Plus, Search, Trash2, UserPlus, Users, Wand2, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/s/$spaceId/departments")({
  head: () => ({
    meta: [
      { title: "Departments — Leepek" },
      {
        name: "description",
        content: "Group your registered people into departments and track them.",
      },
      { property: "og:title", content: "Departments — Leepek" },
      { property: "og:description", content: "Group people into departments and track attendance." },
    ],
  }),
  component: DepartmentsPage,
});

type Match = { id: string; registration_number: string; full_name: string; phone: string | null; isMember: boolean };

function DepartmentsPage() {
  const { spaceId } = Route.useParams();
  const queryClient = useQueryClient();

  const listFn = useServerFn(listDepartments);
  const membersFn = useServerFn(listDepartmentMembers);
  const fieldsFn = useServerFn(listSpaceFields);
  const searchFn = useServerFn(searchPeopleForAssignment);
  const createFn = useServerFn(createDepartment);
  const updateFn = useServerFn(updateDepartment);
  const deleteFn = useServerFn(deleteDepartment);
  const addMemberFn = useServerFn(addDepartmentMember);
  const removeMemberFn = useServerFn(removeDepartmentMember);

  const departments = useQuery({
    queryKey: ["departments", spaceId],
    queryFn: () => listFn({ data: { spaceId } }),
  });
  const fields = useQuery({
    queryKey: ["space-fields", spaceId],
    queryFn: () => fieldsFn({ data: { spaceId } }),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedId && departments.data && departments.data.length > 0) {
      setSelectedId(departments.data[0]!.id);
    }
  }, [departments.data, selectedId]);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const members = useQuery({
    queryKey: ["department-members", spaceId, selectedId, search, page],
    enabled: Boolean(selectedId),
    queryFn: () =>
      membersFn({
        data: { spaceId, departmentId: selectedId!, search: search || undefined, page, pageSize: 25 },
      }),
  });

  // Assignment picker
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerResults, setPickerResults] = useState<Match[] | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);
  async function runPicker() {
    if (pickerQuery.trim().length < 2 || !selectedId) return;
    setPickerBusy(true);
    try {
      const results = await searchFn({
        data: { spaceId, departmentId: selectedId, query: pickerQuery.trim() },
      });
      setPickerResults(results as Match[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Search failed.");
    }
    setPickerBusy(false);
  }

  // Create / edit form
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DepartmentSummary | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sourceFieldKey, setSourceFieldKey] = useState("manual");
  const [busy, setBusy] = useState(false);

  function openCreate() {
    setEditing(null);
    setName("");
    setDescription("");
    setSourceFieldKey("manual");
    setFormOpen(true);
  }
  function openEdit(dept: DepartmentSummary) {
    setEditing(dept);
    setName(dept.name);
    setDescription(dept.description ?? "");
    setSourceFieldKey(dept.sourceFieldKey ?? "manual");
    setFormOpen(true);
  }

  async function save() {
    if (!name.trim()) {
      toast.error("Give the department a name.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        spaceId,
        name: name.trim(),
        description: description.trim() || undefined,
        sourceFieldKey: sourceFieldKey === "manual" ? undefined : sourceFieldKey,
      };
      if (editing) {
        await updateFn({ data: { ...payload, id: editing.id } });
        toast.success("Department updated.");
      } else {
        const created = await createFn({ data: payload });
        setSelectedId(created.id);
        toast.success("Department created.");
      }
      setFormOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["departments", spaceId] });
      await queryClient.invalidateQueries({ queryKey: ["attendance-dashboard", spaceId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    }
    setBusy(false);
  }

  async function remove(dept: DepartmentSummary) {
    if (!window.confirm(`Delete the "${dept.name}" department? Members stay registered.`)) return;
    try {
      await deleteFn({ data: { spaceId, id: dept.id } });
      toast.success("Department deleted.");
      setSelectedId(null);
      await queryClient.invalidateQueries({ queryKey: ["departments", spaceId] });
      await queryClient.invalidateQueries({ queryKey: ["attendance-dashboard", spaceId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete.");
    }
  }

  async function addMember(match: Match) {
    if (!selectedId) return;
    try {
      await addMemberFn({ data: { spaceId, departmentId: selectedId, registrationId: match.id } });
      toast.success(`${match.full_name} added.`);
      setPickerResults((prev) =>
        prev ? prev.map((m) => (m.id === match.id ? { ...m, isMember: true } : m)) : prev,
      );
      await queryClient.invalidateQueries({ queryKey: ["department-members", spaceId] });
      await queryClient.invalidateQueries({ queryKey: ["departments", spaceId] });
      await queryClient.invalidateQueries({ queryKey: ["attendance-dashboard", spaceId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add.");
    }
  }

  async function removeMember(registrationId: string, fullName: string) {
    if (!selectedId) return;
    try {
      await removeMemberFn({ data: { spaceId, departmentId: selectedId, registrationId } });
      toast.success(`${fullName} removed.`);
      await queryClient.invalidateQueries({ queryKey: ["department-members", spaceId] });
      await queryClient.invalidateQueries({ queryKey: ["departments", spaceId] });
      await queryClient.invalidateQueries({ queryKey: ["attendance-dashboard", spaceId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove.");
    }
  }

  const selected = departments.data?.find((d) => d.id === selectedId) ?? null;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl">Departments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Group people into departments — assign them here, or let a form field decide.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-4" />
          New department
        </Button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="space-y-3">
          {formOpen && (
            <Card className="animate-rise">
              <CardContent className="space-y-4 py-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">{editing ? "Edit department" : "New department"}</h2>
                  <Button size="icon" variant="ghost" onClick={() => setFormOpen(false)} aria-label="Close">
                    <X className="size-4" />
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dept-name">Name</Label>
                  <Input
                    id="dept-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Youth, Women, Choir"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dept-desc">Description</Label>
                  <Input
                    id="dept-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Membership</Label>
                  <Select value={sourceFieldKey} onValueChange={setSourceFieldKey}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Assigned manually</SelectItem>
                      {(fields.data ?? []).map((field) => (
                        <SelectItem key={field.key} value={field.key}>
                          Auto from “{field.label}”
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    With a field, everyone whose answer equals this department&apos;s name is a member
                    automatically.
                  </p>
                </div>
                <Button className="w-full" onClick={save} disabled={busy}>
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  {editing ? "Save changes" : "Create department"}
                </Button>
              </CardContent>
            </Card>
          )}

          {departments.isLoading && <Skeleton className="h-32 w-full" />}
          {departments.data?.map((dept) => (
            <button
              key={dept.id}
              onClick={() => {
                setSelectedId(dept.id);
                setPage(1);
                setSearch("");
                setPickerResults(null);
              }}
              className={`w-full rounded-xl border p-4 text-left transition-colors duration-200 ${
                dept.id === selectedId ? "border-accent bg-accent/10" : "hover:bg-muted/60"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{dept.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {dept.members} member{dept.members === 1 ? "" : "s"}
                    {dept.sourceFieldKey ? " · auto" : ""}
                  </p>
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Delete ${dept.name}`}
                  className="rounded p-1 text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(dept);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.stopPropagation();
                      remove(dept);
                    }
                  }}
                >
                  <Trash2 className="size-3.5" />
                </span>
              </div>
            </button>
          ))}
          {departments.data?.length === 0 && !formOpen && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                <Users className="mx-auto size-6 opacity-40" />
                <p className="mt-2">No departments yet.</p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {selected && (
            <>
              <Card>
                <CardContent className="py-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-lg font-semibold">{selected.name}</h2>
                      {selected.description && (
                        <p className="mt-1 text-sm text-muted-foreground">{selected.description}</p>
                      )}
                      {selected.sourceFieldKey && (
                        <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Wand2 className="size-3" /> Membership follows the “{selected.sourceFieldKey}”
                          field on the registration form.
                        </p>
                      )}
                    </div>
                    <Button size="sm" variant="outline" onClick={() => openEdit(selected)}>
                      Edit
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {!selected.sourceFieldKey && (
                <Card>
                  <CardContent className="space-y-3 py-5">
                    <Label className="flex items-center gap-2 text-sm">
                      <UserPlus className="size-4" /> Add people
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        value={pickerQuery}
                        onChange={(e) => setPickerQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            runPicker();
                          }
                        }}
                        placeholder="Search by name, phone or member code"
                      />
                      <Button onClick={runPicker} disabled={pickerBusy || pickerQuery.trim().length < 2}>
                        {pickerBusy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                        Search
                      </Button>
                    </div>
                    {pickerResults && (
                      <ul className="divide-y rounded-lg border">
                        {pickerResults.map((match) => (
                          <li key={match.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                            <div className="min-w-0">
                              <p className="truncate font-medium">{match.full_name}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {match.registration_number}
                                {match.phone ? ` · ${match.phone}` : ""}
                              </p>
                            </div>
                            {match.isMember ? (
                              <span className="text-xs text-muted-foreground">Added</span>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => addMember(match)}>
                                Add
                              </Button>
                            )}
                          </li>
                        ))}
                        {pickerResults.length === 0 && (
                          <li className="px-3 py-3 text-center text-sm text-muted-foreground">
                            No matches.
                          </li>
                        )}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardContent className="py-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold">
                      Members ({members.data?.total ?? "…"})
                    </h2>
                    <Input
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                      }}
                      placeholder="Filter members"
                      className="w-56"
                    />
                  </div>
                  {members.isLoading ? (
                    <Skeleton className="mt-4 h-40 w-full" />
                  ) : (members.data?.members.length ?? 0) === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      {selected.sourceFieldKey
                        ? "Nobody has answered with this department name yet."
                        : "No one has been added yet."}
                    </p>
                  ) : (
                    <ul className="mt-4 divide-y">
                      {(members.data?.members ?? []).map((person) => (
                        <li key={person.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{person.full_name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {person.registration_number}
                              {person.phone ? ` · ${person.phone}` : ""}
                            </p>
                          </div>
                          {!selected.sourceFieldKey && (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Remove ${person.full_name}`}
                              onClick={() => removeMember(person.id, person.full_name)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {(members.data?.total ?? 0) > (members.data?.pageSize ?? 25) && (
                    <div className="mt-4 flex items-center justify-between text-sm">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        Previous
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Page {members.data?.page} of {Math.ceil((members.data?.total ?? 0) / (members.data?.pageSize ?? 25))}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={(members.data?.page ?? 1) * (members.data?.pageSize ?? 25) >= (members.data?.total ?? 0)}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
          {!selected && !formOpen && (
            <Card>
              <CardContent className="py-16 text-center text-sm text-muted-foreground">
                Create or choose a department to see its people.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
