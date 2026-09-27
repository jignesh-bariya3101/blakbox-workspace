import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { changeMemberRole, listMembers, removeMember, transferOwnership } from "../api";

export function MembersPanel({
  workspaceId,
  currentUserId,
  currentRole,
}: {
  workspaceId: string;
  currentUserId: string;
  currentRole?: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const members = useQuery({
    queryKey: ["members", workspaceId],
    queryFn: () => listMembers(workspaceId),
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["members", workspaceId] }),
      queryClient.refetchQueries({ queryKey: ["workspace", workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
    ]);
  };

  const remove = useMutation({
    mutationFn: (userId: string) => removeMember(workspaceId, userId),
    onSuccess: async (_data, userId) => {
      if (userId === currentUserId) {
        navigate("/");
        return;
      }
      await refresh();
    },
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "ADMIN" | "MEMBER" }) =>
      changeMemberRole(workspaceId, userId, role),
    onSuccess: refresh,
  });

  const transfer = useMutation({
    mutationFn: (userId: string) => transferOwnership(workspaceId, userId),
    onSuccess: refresh,
  });

  return (
    <section className="invite-panel">
      <h2>Members</h2>
      {remove.error ? <p className="form-error">{remove.error.message}</p> : null}
      {changeRole.error ? <p className="form-error">{changeRole.error.message}</p> : null}
      {transfer.error ? <p className="form-error">{transfer.error.message}</p> : null}
      <ul className="member-list">
        {members.data?.members.map((member) => (
          <li key={member.userId}>
            <div>
              <strong>{member.email}</strong>
              <p>
                {member.role}
                {member.userId === currentUserId ? " · you" : ""}
              </p>
            </div>
            <div className="row-actions">
              {currentRole === "OWNER" && member.role !== "OWNER" ? (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() =>
                      changeRole.mutate({
                        userId: member.userId,
                        role: member.role === "ADMIN" ? "MEMBER" : "ADMIN",
                      })
                    }
                  >
                    Make {member.role === "ADMIN" ? "member" : "admin"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => transfer.mutate(member.userId)}
                  >
                    Transfer ownership
                  </button>
                </>
              ) : null}
              {member.userId === currentUserId && currentRole !== "OWNER" ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => remove.mutate(member.userId)}
                >
                  Leave
                </button>
              ) : null}
              {member.userId !== currentUserId &&
              ((currentRole === "OWNER" && member.role !== "OWNER") ||
                (currentRole === "ADMIN" && member.role === "MEMBER")) ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => remove.mutate(member.userId)}
                >
                  Remove
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
