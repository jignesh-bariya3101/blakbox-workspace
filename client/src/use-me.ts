import { useQuery } from "@tanstack/react-query";
import { getMe } from "./api";
import { useSessionUi } from "./session-ui";

export function useMe() {
  const { forceGuest } = useSessionUi();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    retry: false,
    gcTime: 0,
  });
  const signedIn = !forceGuest && me.status === "success" && Boolean(me.data);
  return { me, signedIn, user: signedIn ? me.data.user : undefined };
}
