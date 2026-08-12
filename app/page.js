"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import Toast from "./components/Toast";
import { getParkingLevelLabel, getParkingLevelShortLabel } from "../lib/parking-labels";
import { getSlotDisplayNumbers, getStackMapDisplayNumbers, getTierSlotNo, isSurfaceParkingType } from "../lib/slot-naming";

const PARKING_DISCLAIMER = [
  "The selected parking space is final and cannot be changed after confirmation.",
  "The parking selection process is fair, transparent, and based solely on availability. No preferential allotment is provided by the Developer.",
  "No exchange, transfer, or swapping of parking spaces will be permitted by the Developer.",
  "All allottees are required to cooperate during maintenance or operational activities related to the parking area.",
  "The Developer's decision regarding the parking allotment process shall be final and binding."
];

export default function Home() {
  const [auth, setAuth] = useState(null);
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState("");
  const [selectedLevel, setSelectedLevel] = useState("");
  const [mapId, setMapId] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [allottee, setAllottee] = useState("");
  const [stackLevel, setStackLevel] = useState("Top");
  const [message, setMessage] = useState("Loading maps from PostgreSQL...");
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState("");
  const [toast, setToast] = useState(null);
  const [bookingConfirmation, setBookingConfirmation] = useState(null);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const toastTimerRef = useRef(null);
  const locationLoadInFlightRef = useRef(false);
  const queuedLocationLoadRef = useRef(null);

  useEffect(() => {
    const session = getUserSession();
    if (!session) {
      window.location.href = "/login";
      return;
    }
    localStorage.setItem("parking-auth", JSON.stringify(session));
    setAuth(session);
    loadLocations();
  }, []);

  useEffect(() => {
    const socket = io({ transports: ["websocket"] });
    const refresh = (event) => {
      console.log("[socket] user received update", event);
      loadLocations(locationId, mapId, selectedSlotId, { silent: true });
    };
    socket.on("connect", () => console.log("[socket] user connected", socket.id));
    socket.on("slot:changed", refresh);
    socket.on("slot:booked", refresh);
    socket.on("slot:released", refresh);
    socket.on("map:changed", refresh);
    return () => socket.disconnect();
  }, [locationId, mapId, selectedSlotId]);

  async function loadLocations(preferredLocationId = locationId, preferredMapId = mapId, preferredSlotId = selectedSlotId, options = {}) {
    if (locationLoadInFlightRef.current) {
      queuedLocationLoadRef.current = { preferredLocationId, preferredMapId, preferredSlotId, options };
      return;
    }

    locationLoadInFlightRef.current = true;
    if (!options.silent) setLoading(true);
    try {
      const response = await fetch("/api/locations", { cache: "no-store" });
      const data = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(data.detail || data.error || "Could not load locations.");
      }
      const nextLocations = (data.locations || [])
        .map((location) => ({
          ...location,
          maps: (location.maps || []).filter((map) => map.isVisible !== false)
        }))
        .filter((location) => location.maps.length);
      const nextLocation = nextLocations.find((item) => item.id === preferredLocationId) || nextLocations[0];
      const maps = nextLocation?.maps || [];
      const nextMap = maps.find((item) => item.id === preferredMapId) || maps.find((item) => item.parkingLevel === Number(selectedLevel)) || maps[0];

      setLocations(nextLocations);
      setLocationId(nextLocation?.id || "");
      if (nextMap && !selectedLevel) {
        setSelectedLevel("");
      }
      setMapId(nextMap?.id || "");
      setSelectedSlotId(preferredSlotId || "");
      if (!options.silent) {
        setMessage(nextLocations.length ? "Select a parking level to continue." : "No maps found in database.");
      }
    } catch (error) {
      if (!options.silent) {
        setMessage(`Could not load database data: ${error.message}`);
        showToast("error", `Could not load data: ${error.message}`);
      }
    } finally {
      locationLoadInFlightRef.current = false;
      const queuedLoad = queuedLocationLoadRef.current;
      queuedLocationLoadRef.current = null;
      if (!options.silent) setLoading(false);
      if (queuedLoad) {
        loadLocations(
          queuedLoad.preferredLocationId,
          queuedLoad.preferredMapId,
          queuedLoad.preferredSlotId,
          queuedLoad.options
        );
      }
    }
  }

  function showToast(type, message) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ type, message });
    toastTimerRef.current = setTimeout(() => setToast(null), 3200);
  }

  const activeLocation = locations.find((location) => location.id === locationId);
  const levelMaps = useMemo(() => activeLocation?.maps.filter((map) => map.parkingLevel === Number(selectedLevel)) || [], [activeLocation, selectedLevel]);
  const activeMap = levelMaps.find((map) => map.id === mapId) || levelMaps[0];
  const selectedSlot = activeMap?.slots.find((slot) => slot.id === selectedSlotId);
  const isStackSlot = (selectedSlot?.levels?.length || 0) > 1;
  const selectedLevelBooked = isStackSlot && selectedSlot?.bookedLevels?.includes(stackLevel);
  const selectedLevelBooking = selectedSlot ? getBookingForLevel(selectedSlot, stackLevel) : null;
  const sessionMobile = auth?.mobile || "";
  const sessionName = auth?.name || "";
  const sessionEmail = auth?.email || "";
  const sessionAddress = auth?.address || "";
  const userActiveBooking = useMemo(() => {
    return locations
      .flatMap((location) => location.maps)
      .flatMap((map) => map.slots.map((slot) => ({ map, slot })))
      .flatMap(({ map, slot }) => (slot.bookings || []).map((booking) => ({ map, slot, booking })))
      .find((item) => item.booking.mobile === sessionMobile);
  }, [locations, sessionMobile]);

  const canBookSelectedSlot = selectedSlot && !pendingAction && !userActiveBooking && (isStackSlot ? !selectedLevelBooked : selectedSlot.occupancyStatus !== "booked");

  useEffect(() => {
    if (!selectedSlot) {
      setAllottee("");
      setStackLevel("Top");
      return;
    }
    const fallbackLevel = selectedSlot.availableLevels?.[0] || selectedSlot.bookedLevels?.[0] || selectedSlot.levels?.[0] || "Top";
    setStackLevel(fallbackLevel);
  }, [selectedSlot]);

  useEffect(() => {
    if (!selectedSlot) return;
    const booking = getBookingForLevel(selectedSlot, stackLevel);
    setAllottee(booking?.mobile === sessionMobile ? booking?.allottee || sessionName : sessionName);
  }, [selectedSlot, stackLevel, sessionMobile, sessionName]);

  const levelOptions = useMemo(() => {
    const levels = new Set((activeLocation?.maps || []).map((map) => map.parkingLevel || 1));
    return Array.from(levels).sort((a, b) => a - b);
  }, [activeLocation]);

  const levelStats = useMemo(() => {
    const stats = {};
    (activeLocation?.maps || []).forEach((map) => {
      const level = map.parkingLevel || 1;
      const current = stats[level] || {
        maps: 0,
        physicalSlots: 0,
        totalCapacity: 0,
        availableCapacity: 0,
        bookedCapacity: 0,
        partialSlots: 0,
        unavailable: 0,
        typeAvailability: {
          Regular: { capacity: 0, available: 0 },
          Stack: { capacity: 0, available: 0 },
          Surface: { capacity: 0, available: 0 }
        },
        carAvailable: 0,
        surfaceAvailable: 0
      };

      current.maps += 1;
      (map.slots || []).forEach((slot) => {
        const status = slot.occupancyStatus || slot.status || "available";
        const capacity = Math.max(1, slot.levels?.length || 1);
        const booked = Math.min(capacity, slot.bookedLevels?.length || 0);
        const available = status === "reserved" || status === "maintenance" ? 0 : Math.max(0, capacity - booked);
        const typeKey = getParkingTypeGroup(slot);
        current.physicalSlots += 1;
        current.totalCapacity += capacity;
        current.bookedCapacity += booked;
        current.typeAvailability[typeKey].capacity += capacity;
        current.typeAvailability[typeKey].available += available;
        if (typeKey === "Surface") {
          current.surfaceAvailable += available;
        } else {
          current.carAvailable += available;
        }

        if (status === "reserved" || status === "maintenance") {
          current.unavailable += capacity;
        } else {
          current.availableCapacity += available;
        }

        if (status === "partial") current.partialSlots += 1;
      });
      stats[level] = current;
    });
    return stats;
  }, [activeLocation]);

  function selectLocation(nextLocationId) {
    const nextLocation = locations.find((location) => location.id === nextLocationId);
    setLocationId(nextLocationId);
    setSelectedLevel("");
    setMapId(nextLocation?.maps[0]?.id || "");
    setSelectedSlotId("");
  }

  function selectLevel(level) {
    const nextMap = activeLocation?.maps.find((map) => map.parkingLevel === level);
    setSelectedLevel(String(level));
    setMapId(nextMap?.id || "");
    setSelectedSlotId("");
    setMessage(`${getParkingLevelLabel(level)} selected. Click a parking slot to book.`);
  }

  function selectMap(nextMapId) {
    setMapId(nextMapId);
    setSelectedSlotId("");
  }

  function selectSlot(slot) {
    setSelectedSlotId(slot.id);
    setMessage(`${slot.slotNo} selected.`);
  }

  function clearSelection() {
    setSelectedSlotId("");
    setMessage("Selection cleared.");
  }

  async function bookSlot() {
    if (!selectedSlot) {
      showToast("error", "Select a parking slot first.");
      return;
    }
    if (!(sessionName || allottee.trim())) {
      showToast("error", "Enter your name.");
      setMessage("Name is required.");
      return;
    }
    if (userActiveBooking) {
      showToast("error", `You already booked ${userActiveBooking.slot.slotNo}.`);
      setMessage("One user can book only one active slot for now.");
      return;
    }
    const displayStatus = selectedSlot.occupancyStatus || selectedSlot.status;
    if (displayStatus === "reserved" || displayStatus === "maintenance") {
      showToast("error", `${selectedSlot.slotNo} is ${displayStatus}.`);
      return;
    }

    const bookingLevel = selectedSlot.levels?.length > 1 ? stackLevel : "Single";
    setBookingConfirmation({
      slotId: selectedSlot.id,
      slotNo: getTierSlotNo(selectedSlot, bookingLevel),
      physicalSlotNo: selectedSlot.slotNo,
      bookingLevel,
      allottee: sessionName || allottee.trim(),
      mobile: sessionMobile,
      email: sessionEmail,
      address: sessionAddress,
      location: activeLocation?.name || "",
      parkingName: activeLocation?.parkingName || activeMap?.name || "",
      map: activeMap?.name || "",
      parkingLevel: selectedLevel
    });
  }

  async function confirmBooking() {
    if (!bookingConfirmation) return;
    setPendingAction("book");
    try {
      const response = await fetch(`/api/slots/${bookingConfirmation.slotId}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allottee: bookingConfirmation.allottee,
          mobile: bookingConfirmation.mobile,
          email: bookingConfirmation.email,
          address: bookingConfirmation.address,
          level: bookingConfirmation.bookingLevel
        })
      });
      const data = await response.json();
      if (!response.ok) {
        const error = data.error || "Booking failed.";
        setMessage(error);
        showToast("error", error);
        return;
      }
      const success = bookingConfirmation.bookingLevel !== "Single"
        ? `${bookingConfirmation.slotNo} ${bookingConfirmation.bookingLevel} booked.`
        : `${bookingConfirmation.slotNo} booked.`;
      setMessage(success);
      showToast("success", success);
      await downloadBookingReceipt({
        bookingId: data.booking?.id,
        receiptNo: data.booking?.receiptNo,
        name: bookingConfirmation.allottee,
        mobile: bookingConfirmation.mobile,
        email: bookingConfirmation.email,
        address: bookingConfirmation.address,
        location: bookingConfirmation.location,
        parkingName: bookingConfirmation.parkingName,
        map: bookingConfirmation.map,
        parkingLevel: bookingConfirmation.parkingLevel,
        slotNo: bookingConfirmation.slotNo,
        stackLevel: bookingConfirmation.bookingLevel,
        disclaimer: PARKING_DISCLAIMER,
        bookedAt: data.booking?.createdAt || new Date().toISOString()
      });
      setBookingConfirmation(null);
      setShowDisclaimer(false);
      await loadLocations(locationId, mapId, bookingConfirmation.slotId);
    } catch (error) {
      setMessage(`Booking failed: ${error.message}`);
      showToast("error", `Booking failed: ${error.message}`);
    } finally {
      setPendingAction("");
    }
  }

  function logout() {
    localStorage.removeItem("parking-auth");
    window.location.href = "/login";
  }

  if (!auth) {
    return <main className="auth-page"><p>Redirecting...</p></main>;
  }

  if (!selectedLevel) {
    return (
      <main className="app-shell level-shell">
        <header className="topbar">
          <BrandHeading eyebrow="Level Selection" title="Select Parking Level" />
          <nav className="top-actions">
            <button className="ghost inline-action user-logout" onClick={logout}>Logout</button>
          </nav>
        </header>
        <section className="level-selector">
          <div className="level-card">
            <label>
              Location
              <select value={locationId} onChange={(event) => selectLocation(event.target.value)} disabled={loading}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
            </label>
            <div className="level-grid">
              {levelOptions.length ? levelOptions.map((level) => {
                const levelMap = activeLocation?.maps.find((map) => map.parkingLevel === level);
                const parkingName = levelMap?.name || activeLocation?.parkingName || "Parking";
                return (
                  <button className="level-button" key={level} onClick={() => selectLevel(level)}>
                    <span>{parkingName}</span>
                    <small>{getParkingLevelLabel(level)}</small>
                    <dl className="level-stats simple-availability">
                      <div><dt>Car Parking</dt><dd>{levelStats[level]?.carAvailable || 0}</dd></div>
                      <div><dt>Surface Parking</dt><dd>{levelStats[level]?.surfaceAvailable || 0}</dd></div>
                    </dl>
                  </button>
                );
              }) : <p className="empty">No level maps uploaded yet.</p>}
            </div>
            {userActiveBooking && (
              <p className="message">Active booking: {userActiveBooking.slot.slotNo} on {getParkingLevelLabel(userActiveBooking.map.parkingLevel)}.</p>
            )}
            <p className="message">{message}</p>
          </div>
        </section>
        <Toast toast={toast} onClose={() => setToast(null)} />
      </main>
    );
  }

  return (
    <main className="user-map-shell">
      <header className="map-topbar">
        <BrandHeading eyebrow={activeLocation?.name || "Location"} title={`${getParkingLevelLabel(selectedLevel)} Parking`} />
        <nav className="top-actions">
          <button className="ghost inline-action" onClick={() => { setSelectedLevel(""); setSelectedSlotId(""); }}>Levels</button>
          <button className="ghost inline-action" onClick={logout}>Logout</button>
        </nav>
      </header>

      <section className="user-map-view">
        <div className="floating-levels">
          {levelOptions.map((level) => (
            <button key={level} className={String(level) === selectedLevel ? "active" : ""} onClick={() => selectLevel(level)}>
              {getParkingLevelShortLabel(level)}
            </button>
          ))}
        </div>

        {levelMaps.length > 1 && (
          <div className="floating-maps">
            {levelMaps.map((map) => (
              <button key={map.id} className={map.id === activeMap?.id ? "active" : ""} onClick={() => selectMap(map.id)}>
                {map.name}
              </button>
            ))}
          </div>
        )}

        {activeMap ? (
          <div className="map-stage user-stage">
            <div className="map-frame" onClick={clearSelection}>
              {isPdfMap(activeMap.file) ? (
                <iframe title={activeMap.name} src={`${activeMap.file}#toolbar=0&navpanes=0&view=FitH`} />
              ) : (
                <img className="map-image" src={activeMap.file} alt={activeMap.name} />
              )}
              <div className="slot-layer" aria-label="Clickable parking slots">
                {activeMap.slots.map((slot) => (
                  <SlotMarker
                    key={slot.id}
                    slot={slot}
                    selected={selectedSlotId === slot.id}
                    onSelect={(event) => {
                      event.stopPropagation();
                      selectSlot(slot);
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="empty-map">No map uploaded for this level.</div>
        )}
      </section>
      <Toast toast={toast} onClose={() => setToast(null)} />
      {selectedSlot && (
        <SlotBookingPopup
          activeMap={activeMap}
          allottee={allottee}
          canBook={canBookSelectedSlot}
          message={userActiveBooking ? `Active booking ${getTierSlotNo(userActiveBooking.slot, userActiveBooking.booking.level || "Single")}. Admin can release it.` : message}
          onBook={bookSlot}
          onClose={clearSelection}
          onNameChange={setAllottee}
          onStackLevelChange={setStackLevel}
          pending={pendingAction === "book"}
          selectedLevel={selectedLevel}
          selectedLevelBooking={selectedLevelBooking}
          sessionAddress={sessionAddress}
          sessionEmail={sessionEmail}
          sessionMobile={sessionMobile}
          sessionName={sessionName}
          slot={selectedSlot}
          stackLevel={stackLevel}
        />
      )}
      {bookingConfirmation && (
        <BookingConfirmModal
          booking={bookingConfirmation}
          pending={pendingAction === "book"}
          onCancel={() => setBookingConfirmation(null)}
          onConfirm={() => setShowDisclaimer(true)}
        />
      )}
      {showDisclaimer && (
        <DisclaimerModal
          pending={pendingAction === "book"}
          onCancel={() => setShowDisclaimer(false)}
          onProceed={confirmBooking}
        />
      )}
    </main>
  );
}

function getParkingTypeGroup(slot) {
  if (isSurfaceParkingType(slot?.type)) return "Surface";
  if ((slot?.levels?.length || 0) > 1 || String(slot?.type || "").includes("Stack")) return "Stack";
  return "Regular";
}

function BrandHeading({ eyebrow, title }) {
  return (
    <div className="brand-heading">
      <img src="/brand/shreeji-logo.jpeg" alt="Shreeji Group" />
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
    </div>
  );
}

function SlotMarker({ slot, selected, onSelect }) {
  const displayNumbers = getSlotDisplayNumbers(slot);
  const mapDisplayNumbers = getStackMapDisplayNumbers(slot);
  const isStack = displayNumbers.length > 1;
  const displayStatus = slot.occupancyStatus || slot.status;
  const isBlocked = displayStatus === "reserved" || displayStatus === "maintenance";

  return (
    <button
      className={`slot ${displayStatus} ${selected ? "is-selected" : ""} ${isStack ? "is-stack" : ""}`}
      style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
      onClick={onSelect}
      title={`${slot.slotNo} ${displayStatus}`}
      type="button"
    >
      {isStack ? (
        <span className="stack-flags">
          {mapDisplayNumbers.map((item) => (
            <span className={`stack-flag ${isBlocked ? displayStatus : item.booked ? "booked" : "available"}`} key={item.level}>
              {item.slotNo}
            </span>
          ))}
        </span>
      ) : (
        <span className="slot-number">{displayNumbers[0]?.slotNo || slot.slotNo}</span>
      )}
    </button>
  );
}

function SlotBookingPopup({
  activeMap,
  allottee,
  canBook,
  message,
  onBook,
  onClose,
  onNameChange,
  onStackLevelChange,
  pending,
  selectedLevel,
  selectedLevelBooking,
  sessionEmail,
  sessionMobile,
  sessionName,
  sessionAddress,
  slot,
  stackLevel
}) {
  const displayNumbers = getSlotDisplayNumbers(slot);
  const isStack = displayNumbers.length > 1;

  return (
    <div className="slot-popup-backdrop" role="presentation" onClick={onClose}>
      <section className="slot-popup" role="dialog" aria-modal="true" aria-labelledby="slot-popup-title" onClick={(event) => event.stopPropagation()}>
        <div className="slot-popup-head">
          <div>
            <p className="section-label">Selected Slot</p>
            <h2 id="slot-popup-title">{getTierSlotNo(slot, stackLevel)}</h2>
          </div>
          <button className="icon-close" type="button" onClick={onClose} aria-label="Close">x</button>
        </div>

        <dl className="details">
          <div><dt>Phone</dt><dd>{sessionMobile}</dd></div>
          <div><dt>Email</dt><dd>{sessionEmail || "-"}</dd></div>
          <div><dt>Name</dt><dd>{sessionName || "-"}</dd></div>
          <div><dt>Address</dt><dd>{sessionAddress || "-"}</dd></div>
          <div><dt>Level</dt><dd>{getParkingLevelLabel(selectedLevel)}</dd></div>
          <div><dt>Map</dt><dd>{activeMap?.name || "-"}</dd></div>
          <div><dt>Status</dt><dd>{slot.occupancyStatus || slot.status || "-"}</dd></div>
          {selectedLevelBooking && <div><dt>Booked By</dt><dd>{selectedLevelBooking.allottee}</dd></div>}
          {selectedLevelBooking?.createdAt && <div><dt>Booked At</dt><dd>{formatDateTime(selectedLevelBooking.createdAt)}</dd></div>}
        </dl>

        {isStack && (
          <div className="tier-picker" role="group" aria-label="Stack parking tiers">
            {displayNumbers.map((item) => (
              <button
                className={`tier-option ${item.booked ? "booked" : "available"} ${stackLevel === item.level ? "active" : ""}`}
                key={item.level}
                onClick={() => onStackLevelChange(item.level)}
                type="button"
              >
                <strong>{item.slotNo}</strong>
                <span>{item.level}</span>
                <small>{item.booked ? "Booked" : "Empty"}</small>
              </button>
            ))}
          </div>
        )}

        <label>
          Name
          <input value={sessionName || allottee} disabled={Boolean(sessionName)} onChange={(event) => onNameChange(event.target.value)} placeholder="Your name" />
        </label>
        <button className="primary" onClick={onBook} disabled={!canBook}>
          {pending ? "Booking..." : "Book Parking"}
        </button>
        <p className="message">{message}</p>
      </section>
    </div>
  );
}

function BookingConfirmModal({ booking, pending, onCancel, onConfirm }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={pending ? undefined : onCancel}>
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="booking-confirm-title" onClick={(event) => event.stopPropagation()}>
        <p className="section-label">Confirm Booking</p>
        <h2 id="booking-confirm-title">{booking.slotNo}</h2>
        <dl className="confirm-details">
          <div><dt>Name</dt><dd>{booking.allottee}</dd></div>
          <div><dt>Phone</dt><dd>{booking.mobile}</dd></div>
          <div><dt>Email</dt><dd>{booking.email || "-"}</dd></div>
          <div><dt>Address</dt><dd>{booking.address || "-"}</dd></div>
          <div><dt>Level</dt><dd>{getParkingLevelLabel(booking.parkingLevel)}</dd></div>
          <div><dt>Map</dt><dd>{booking.map || "-"}</dd></div>
          <div><dt>Stack Position</dt><dd>{booking.bookingLevel}</dd></div>
        </dl>
        <p className="message">Please confirm before we reserve this parking slot.</p>
        <div className="modal-actions">
          <button className="ghost" type="button" onClick={onCancel} disabled={pending}>Cancel</button>
          <button className="primary" type="button" onClick={onConfirm} disabled={pending}>
            Continue
          </button>
        </div>
      </section>
    </div>
  );
}

function DisclaimerModal({ pending, onCancel, onProceed }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={pending ? undefined : onCancel}>
      <section className="disclaimer-modal" role="dialog" aria-modal="true" aria-labelledby="parking-disclaimer-title" onClick={(event) => event.stopPropagation()}>
        <p className="section-label">Parking Selection Disclaimer</p>
        <h2 id="parking-disclaimer-title">Please Review Before Proceeding</h2>
        <p>By proceeding with the parking selection, you agree to the following:</p>
        <ul>
          {PARKING_DISCLAIMER.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p>By clicking "Proceed", you confirm that you have read, understood, and accepted the above terms and conditions.</p>
        <div className="modal-actions">
          <button className="ghost" type="button" onClick={onCancel} disabled={pending}>Cancel</button>
          <button className="primary" type="button" onClick={onProceed} disabled={pending}>
            {pending ? "Booking..." : "Proceed"}
          </button>
        </div>
      </section>
    </div>
  );
}

function isPdfMap(file) {
  return String(file || "").toLowerCase().endsWith(".pdf");
}

function getUserSession() {
  try {
    const session = JSON.parse(localStorage.getItem("parking-auth") || "{}");
    const mobile = String(session.mobile || session.phone || session.name || "").replace(/\D/g, "");
    if (session.role === "user" && /^[0-9]{10}$/.test(mobile)) {
      return {
        role: "user",
        id: session.id || "",
        name: session.name || "",
        mobile,
        email: session.email || "",
        address: session.address || ""
      };
    }
  } catch {
    return null;
  }
  return null;
}

function getBookingForLevel(slot, level) {
  const normalizedLevel = slot.levels?.length > 1 ? level : "Single";
  return slot.bookings?.find((booking) => (booking.level || "Single") === normalizedLevel);
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

async function downloadBookingReceipt(receipt) {
  const receiptNo = receipt.receiptNo || receipt.bookingId || "PENDING";
  const logo = await loadReceiptLogo();
  const commands = [
    "1 0.98 0.96 rg 0 0 595 842 re f",
    "0.957 0.498 0.271 rg 0 742 595 100 re f",
    logo ? "q 96 0 0 52 58 768 cm /Logo Do Q" : "",
    textAt(176, 800, "SHREEJI GROUP", 22, "F2", "1 1 1"),
    textAt(176, 778, "OF COMPANIES", 11, "F2", "1 1 1"),
    textAt(176, 762, "Building Bonds Of Trust", 10, "F1", "1 1 1"),
    textAt(364, 794, "PARKING RECEIPT", 16, "F2", "1 1 1"),
    textAt(364, 772, `Receipt No: ${receiptNo}`, 12, "F2", "1 1 1"),
    "0.86 0.78 0.71 RG 58 716 m 537 716 l S",
    textAt(58, 690, "Customer Details", 14, "F2", "0.125 0.098 0.078"),
    textAt(58, 530, "Parking Details", 14, "F2", "0.125 0.098 0.078"),
    textAt(58, 252, "Status", 14, "F2", "0.125 0.098 0.078")
  ];

  let y = 662;
  y = addPdfRows(commands, [
    ["Name", receipt.name],
    ["Phone", receipt.mobile],
    ["Email", receipt.email || "-"],
    ["Address / Flat", receipt.address || "-"]
  ], y);

  y = 502;
  y = addPdfRows(commands, [
    ["Location", receipt.location],
    ["Parking", receipt.parkingName || receipt.map],
    ["Map", receipt.map],
    ["Parking Level", getParkingLevelLabel(receipt.parkingLevel)],
    ["Slot", receipt.slotNo],
    ["Stack Position", receipt.stackLevel],
    ["Booked At", formatDateTime(receipt.bookedAt)]
  ], y);

  y = addPdfRows(commands, [
    ["Booking Status", "Confirmed"],
    ["Generated By", "Shreeji Plaza Parking System"]
  ], 224);
  y -= 4;
  commands.push(textAt(58, y, "Parking Selection Disclaimer", 12, "F2", "0.125 0.098 0.078"));
  y -= 18;
  (receipt.disclaimer || PARKING_DISCLAIMER).forEach((item, index) => {
    const wrapped = wrapPdfText(`${index + 1}. ${item}`, 112);
    wrapped.forEach((line, lineIndex) => {
      commands.push(textAt(58, y - lineIndex * 9, line, 6.3, "F1", "0.459 0.424 0.392"));
    });
    y -= Math.max(11, wrapped.length * 9 + 2);
  });
  commands.push(textAt(58, Math.max(36, y - 8), "Accepted by user by clicking Proceed before booking confirmation.", 7, "F2", "0.459 0.424 0.392"));
  commands.push("0.86 0.78 0.71 RG 58 24 m 537 24 l S");
  commands.push(textAt(58, 10, "This receipt is system generated for parking slot reservation.", 7, "F1", "0.459 0.424 0.392"));

  const content = commands.join("\n");
  const resources = logo
    ? "<< /Font << /F1 4 0 R /F2 5 0 R >> /XObject << /Logo 7 0 R >> >>"
    : "<< /Font << /F1 4 0 R /F2 5 0 R >> >>";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources ${resources} /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  ];
  if (logo) {
    objects.push({
      header: `<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.bytes.byteLength} >>\nstream\n`,
      bytes: logo.bytes,
      footer: "\nendstream"
    });
  }

  const encoder = new TextEncoder();
  const chunks = [];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(byteLengthOfChunks(chunks) + encoder.encode(pdf).byteLength);
    chunks.push(encoder.encode(pdf));
    pdf = `${index + 1} 0 obj\n`;
    if (typeof object === "string") {
      pdf += `${object}\nendobj\n`;
    } else {
      chunks.push(encoder.encode(pdf + object.header));
      chunks.push(object.bytes);
      pdf = `${object.footer}\nendobj\n`;
    }
  });
  const xrefOffset = byteLengthOfChunks(chunks) + encoder.encode(pdf).byteLength;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(encoder.encode(pdf));

  const blob = new Blob(chunks, { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `parking-receipt-${receipt.slotNo}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function byteLengthOfChunks(chunks) {
  return chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
}

async function loadReceiptLogo() {
  try {
    const [response, dimensions] = await Promise.all([
      fetch("/brand/shreeji-logo.jpeg"),
      getImageDimensions("/brand/shreeji-logo.jpeg")
    ]);
    if (!response.ok) return null;
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      width: dimensions.width,
      height: dimensions.height
    };
  } catch {
    return null;
  }
}

function getImageDimensions(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = src;
  });
}

function escapePdfText(value) {
  return String(value || "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function textAt(x, y, value, size = 11, font = "F1", color = "0 0 0") {
  return `${color} rg BT /${font} ${size} Tf ${x} ${y} Td (${escapePdfText(value)}) Tj ET`;
}

function addPdfRows(commands, rows, startY) {
  let y = startY;
  rows.forEach(([label, value]) => {
    commands.push("0.957 0.498 0.271 rg 58 " + (y - 8) + " 4 20 re f");
    commands.push(textAt(76, y, label, 10, "F2", "0.459 0.424 0.392"));
    const wrapped = wrapPdfText(value || "-", 48);
    wrapped.forEach((line, index) => {
      commands.push(textAt(196, y - index * 16, line, 11, index === 0 ? "F2" : "F1", "0.125 0.098 0.078"));
    });
    y -= Math.max(30, wrapped.length * 16 + 12);
  });
  return y;
}

function wrapPdfText(value, maxLength) {
  const words = String(value || "").split(/\s+/);
  const lines = [];
  let line = "";
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxLength && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);
  return lines.length ? lines : ["-"];
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 180) };
  }
}
