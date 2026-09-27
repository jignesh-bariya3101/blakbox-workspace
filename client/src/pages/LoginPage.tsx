import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { login } from "../api";
import { useSessionUi } from "../session-ui";
import { Brand } from "../components/Brand";
import { safeNext } from "../safe-next";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters"),
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const { setForceGuest } = useSessionUi();
  const form = useForm<FormValues>({ resolver: zodResolver(schema) });
  const mutation = useMutation({
    mutationFn: (values: FormValues) => login(values.email, values.password),
    onSuccess: async () => {
      setForceGuest(false);
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      navigate(safeNext(params.toString()));
    },
  });

  return (
    <div className="auth-layout">
      <section className="auth-story">
        <Brand light />
        <div>
          <h1>Pick up where the team left the files.</h1>
          <p>Sessions last seven days. Signing out only ends this browser session.</p>
        </div>
        <p>BlakBox · workspace documents</p>
      </section>
      <section className="auth-form-wrap">
        <div className="auth-card">
          <h2>Sign in</h2>
          <p className="lede">Use the email you registered with.</p>
          <form className="form" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
            <label>
              Email
              <input type="email" autoComplete="email" {...form.register("email")} />
            </label>
            {form.formState.errors.email ? (
              <p className="field-error">{form.formState.errors.email.message}</p>
            ) : null}
            <label>
              Password
              <input type="password" autoComplete="current-password" {...form.register("password")} />
            </label>
            {form.formState.errors.password ? (
              <p className="field-error">{form.formState.errors.password.message}</p>
            ) : null}
            {mutation.error ? <p className="form-error">{mutation.error.message}</p> : null}
            <button className="btn btn-primary" type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <p>
            No account?{" "}
            <Link to={`/register${params.toString() ? `?${params.toString()}` : ""}`}>Create one</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
