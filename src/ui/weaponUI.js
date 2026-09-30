// ===============================
// Weapon UI — DOM-based (crisp at any resolution)
//
// Weapon slots and pickup prompt are HTML elements so they render
// at full CSS pixel resolution regardless of the game canvas scale.
// ===============================
"use strict";

// ── Touch squares beside the weapon slots (landscape touch only) ──
// Left: flashlight toggle. Right: ACTION, shown only while something can be
// activated. ACTION sends the same synthetic F keydown the gamepad A button
// does, so it rides/leaves the hover bike, opens and accepts Node War
// prompts and talks to NPCs exactly like F; with nothing else in reach it
// picks up a nearby weapon.
function _shown(id) {
    var el = document.getElementById(id);
    return !!(el && el.style.display && el.style.display !== 'none');
}

function touchActionLabel() {
    if (typeof HoverBikeRide !== 'undefined' && HoverBikeRide.isMounted()) return 'EXIT';
    if (_shown('dialog-box'))      return 'NEXT';
    if (_shown('nw-confirm'))      return 'OK';
    if (_shown('bike-prompt'))     return 'RIDE';
    if (_shown('nw-prompt'))       return 'USE';
    if (_shown('interact-prompt')) return 'TALK';
    if (nearbyWeapon)              return 'TAKE';
    return null;
}

function _onTouchSquare(el, fn) {
    el.addEventListener('touchstart', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (!touchControls.enabled) enableTouchControls();
        fn();
    }, { passive: false });
}

var _touchSquaresBound = false;
function _bindTouchSquares() {
    if (_touchSquaresBound) return;
    var flash = document.getElementById('touch-flash-btn');
    var act   = document.getElementById('touch-action-btn');
    if (!flash || !act) return;
    _touchSquaresBound = true;
    _onTouchSquare(flash, function () {
        if (typeof ToggleFlashlight === 'function') ToggleFlashlight();
    });
    _onTouchSquare(act, function () {
        var label = touchActionLabel();
        if (!label) return;
        if (label === 'TAKE') {
            input.pickupWeapon = true;
            setTimeout(function () { input.pickupWeapon = false; }, 100);
        } else {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF' }));
        }
    });
}

function _placeTouchSquares(slotsEl, slotPx, gapPx, scale) {
    var flash = document.getElementById('touch-flash-btn');
    var act   = document.getElementById('touch-action-btn');
    if (!flash || !act) return;
    var on = typeof isTouchLandscape === 'function' && isTouchLandscape();
    if (!on) { flash.style.display = 'none'; act.style.display = 'none'; return; }
    _bindTouchSquares();

    var r = slotsEl.getBoundingClientRect();
    var bottom = (window.innerHeight - r.bottom) + 'px';
    var font = Math.round(11 * scale) + 'px';
    [flash, act].forEach(function (el) {
        el.style.width = el.style.height = slotPx + 'px';
        el.style.bottom = bottom;
        el.style.fontSize = font;
    });
    flash.style.left = (r.left - gapPx - slotPx) + 'px';
    flash.style.display = 'flex';
    flash.style.borderColor = flashlightOn ? '#ffe9a8' : 'rgba(80,160,220,0.2)';
    flash.style.color       = flashlightOn ? '#ffe9a8' : 'rgba(138,176,200,0.6)';
    flash.style.background  = flashlightOn ? 'rgba(255,233,168,0.15)' : 'rgba(8,15,22,0.82)';

    var label = touchActionLabel();
    act.style.display = label ? 'flex' : 'none';
    if (label) {
        act.style.left = (r.right + gapPx) + 'px';
        if (act.textContent !== label) act.textContent = label;
    }
}

function DrawWeaponUI(ctx) {
    var scale = uiScale.weaponUI;

    // ── Weapon slots ──────────────────────────────────────────
    var slotsEl = document.getElementById('weapon-slots-ui');
    if (!slotsEl) return;

    touchControls.weaponSlots = [];

    // Apply uiScale to slot and gap sizes
    var slotPx = Math.round(50 * scale);
    var gapPx  = Math.round(10 * scale);
    slotsEl.style.gap = gapPx + 'px';

    // Rebuild slot elements only when weapon count changes
    if (slotsEl.children.length !== playerWeapons.length) {
        slotsEl.innerHTML = '';
        for (var j = 0; j < playerWeapons.length; j++) {
            var div = document.createElement('div');
            div.className = 'ws-slot';
            div.innerHTML = '<span class="ws-letter"></span><span class="ws-ammo"></span>';
            // Tap a square to switch to that weapon. The slots sit above the
            // canvas and take the touch themselves, so the canvas handler
            // never sees it -- listen here.
            (function (index) {
                _onTouchSquare(div, function () {
                    if (index < playerWeapons.length) currentWeaponIndex = index;
                });
            })(j);
            slotsEl.appendChild(div);
        }
    }

    var slotEls = slotsEl.querySelectorAll('.ws-slot');
    for (var i = 0; i < playerWeapons.length; i++) {
        var slotData = playerWeapons[i];
        var weapon   = weapons[slotData.type];
        var isActive = (i === currentWeaponIndex);
        var el       = slotEls[i];
        if (!el) continue;

        // Size
        el.style.width  = slotPx + 'px';
        el.style.height = slotPx + 'px';

        // Border / background — weapon colour when active
        el.style.borderColor = isActive ? weapon.color   : 'rgba(80,160,220,0.2)';
        el.style.borderWidth = isActive ? '2px'          : '1px';
        el.style.background  = isActive ? weapon.bgColor : 'rgba(8,15,22,0.82)';

        var letterEl = el.querySelector('.ws-letter');
        var ammoEl   = el.querySelector('.ws-ammo');

        letterEl.textContent  = weapon.letter;
        letterEl.style.color  = isActive ? '#c0d8e8' : 'rgba(138,176,200,0.4)';
        letterEl.style.fontSize = Math.round(22 * scale) + 'px';

        var ammoText        = slotData.ammo === Infinity ? '\u221E' : String(slotData.ammo);
        ammoEl.textContent  = ammoText;
        ammoEl.style.color  = slotData.isReloading ? '#cc6666' : '#8ab0c8';
        ammoEl.style.fontSize = Math.round(10 * scale) + 'px';

        // Touch hitbox — CSS pixel coords match touch event clientX/clientY
        var rect = el.getBoundingClientRect();
        touchControls.weaponSlots.push({
            x: rect.left, y: rect.top,
            w: rect.width, h: rect.height,
            index: i
        });
    }

    _placeTouchSquares(slotsEl, slotPx, gapPx, scale);

    // ── Pickup prompt ─────────────────────────────────────────
    var promptEl = document.getElementById('pickup-prompt');
    if (promptEl) {
        if (nearbyWeapon) {
            var weaponDef = weapons[nearbyWeapon.type];
            promptEl.textContent = '[E]  Pick up ' + weaponDef.name;
            promptEl.style.display = 'block';
            var pr = promptEl.getBoundingClientRect();
            touchControls.pickupHitbox = {
                x: pr.left, y: pr.top,
                w: pr.width, h: pr.height
            };
        } else {
            promptEl.style.display  = 'none';
            touchControls.pickupHitbox = null;
        }
    }
}
