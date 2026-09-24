"use client";

import { openAccount } from "@/lib/account-events";

/** Shown by any panel that needs an account: says why, and opens the form
 *  right there instead of asking the reader to find a button elsewhere. */
export default function SignInPrompt({ why }: { why: string }) {
  return (
    <div className="signin-prompt">
      <b>NECESITÁS UNA CUENTA</b>
      <span>{why}</span>
      <div>
        <button onClick={() => openAccount("register")}>CREAR CUENTA GRATIS</button>
        <button className="ghost" onClick={() => openAccount("login")}>YA TENGO CUENTA</button>
      </div>
    </div>
  );
}
