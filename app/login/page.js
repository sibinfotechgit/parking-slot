"use client";

import { useState } from "react";

const OTP_LOGIN_DISABLED = false;

export default function UserLoginPage() {
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [demoOtp, setDemoOtp] = useState("");
  const [step, setStep] = useState("mobile");
  const [pending, setPending] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");
  const [alertTitle, setAlertTitle] = useState("Could Not Continue");
  const [message, setMessage] = useState(
    OTP_LOGIN_DISABLED ? "OTP is temporarily disabled. Enter mobile number to continue." : "Login with mobile OTP."
  );

  async function loginDirectly(event) {
    event.preventDefault();
    if (mobile.length !== 10) {
      setMessage("Enter a valid 10 digit mobile number.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/auth/user-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile })
      });
      const data = await response.json();
      if (!response.ok) {
        showLoginAlert(data.error || "Login failed.");
        return;
      }
      localStorage.setItem("parking-auth", JSON.stringify(data.user));
      window.location.href = "/";
    } catch (error) {
      showLoginAlert(`Login failed: ${error.message}`);
    } finally {
      setPending(false);
    }
  }

  // WhatsApp OTP flow is kept here for future re-enable.
  async function requestOtp(event) {
    event.preventDefault();
    setPending(true);
    try {
      const response = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile })
      });
      const data = await response.json();
      if (!response.ok) {
        showLoginAlert(data.error || "Could not send OTP.", data.launchLocked ? "Parking Starts Soon" : "Could Not Continue");
        return;
      }
      setDemoOtp(data.demoOtp || "");
      setStep("otp");
      setMessage(data.message || "OTP sent.");
    } catch (error) {
      showLoginAlert(`Could not send OTP: ${error.message}`);
    } finally {
      setPending(false);
    }
  }

  async function verifyOtp(event) {
    event.preventDefault();
    setPending(true);
    try {
      const response = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile, otp })
      });
      const data = await response.json();
      if (!response.ok) {
        showLoginAlert(data.error || "OTP verification failed.");
        return;
      }
      localStorage.setItem("parking-auth", JSON.stringify(data.user));
      window.location.href = "/";
    } catch (error) {
      showLoginAlert(`OTP verification failed: ${error.message}`);
    } finally {
      setPending(false);
    }
  }

  function showLoginAlert(text, title = "Could Not Continue") {
    setAlertTitle(title);
    setMessage(text);
    setAlertMessage(text);
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={OTP_LOGIN_DISABLED ? loginDirectly : step === "mobile" ? requestOtp : verifyOtp}>
        <img className="auth-logo" src="/brand/shreeji-logo.jpeg" alt="Shreeji Group" />
        <p className="eyebrow">User Login</p>
        <h1>{OTP_LOGIN_DISABLED ? "Shreeji Parking Login" : "Shreeji Parking OTP Login"}</h1>
        <label>
          Mobile Number
          <input value={mobile} disabled={!OTP_LOGIN_DISABLED && step === "otp"} onChange={(event) => setMobile(event.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="9876543210" />
        </label>
        {!OTP_LOGIN_DISABLED && step === "otp" && (
          <>
            {demoOtp && (
              <div className="demo-otp">
                <span>Demo OTP</span>
                <strong>{demoOtp}</strong>
              </div>
            )}
            <label>
              Enter OTP
              <input value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6 digit OTP" />
            </label>
          </>
        )}
        <button className="primary" disabled={pending}>
          {pending ? "Please wait..." : OTP_LOGIN_DISABLED ? "Continue" : step === "mobile" ? "Send OTP" : "Verify & Continue"}
        </button>
        {!OTP_LOGIN_DISABLED && step === "otp" && <button className="ghost" type="button" disabled={pending} onClick={() => { setStep("mobile"); setOtp(""); setDemoOtp(""); }}>Change Mobile</button>}
        <p className="message">{message}</p>
        {/* Admin login link is hidden; admin access remains available directly at /admin/login. */}
      </form>
      {alertMessage && (
        <div className="modal-backdrop" role="presentation" onClick={() => setAlertMessage("")}>
          <section className="login-alert-modal" role="alertdialog" aria-modal="true" aria-labelledby="login-alert-title" onClick={(event) => event.stopPropagation()}>
            <p className="section-label">Login Access</p>
            <h2 id="login-alert-title">{alertTitle}</h2>
            <p>{alertMessage}</p>
            <button className="primary" type="button" onClick={() => setAlertMessage("")}>Okay</button>
          </section>
        </div>
      )}
    </main>
  );
}
