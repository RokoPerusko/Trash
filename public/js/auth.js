// Prijava u sucelje: provjerava sesiju i, ako treba, prikazuje formu. Korisnici su isti kao na
// OTS-u; lozinka se salje samo na nas backend (HTTPS u produkciji), a sesija je u HttpOnly
// kolacicu koji JavaScript ne moze procitati.
import { $, api } from './util.js';

function showLogin() {
  const form = $('loginForm');
  const error = $('loginError');
  $('login').hidden = false;
  $('loginUser').focus();

  return new Promise((resolve) => {
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      error.hidden = true;
      $('loginSubmit').disabled = true;
      try {
        const res = await api('POST', '/api/login', {
          username: $('loginUser').value,
          password: $('loginPass').value,
        });
        $('loginPass').value = '';
        $('login').hidden = true;
        resolve({
          authRequired: true,
          authenticated: true,
          user: res.user,
          roles: res.roles,
          canEdit: res.canEdit,
        });
      } catch (e) {
        error.textContent = e.message;
        error.hidden = false;
        $('loginPass').value = '';
        $('loginPass').focus();
      } finally {
        $('loginSubmit').disabled = false;
      }
    });
  });
}

// vraca stanje sesije; ako je prijava obavezna a korisnik nije prijavljen, ceka prijavu
export async function ensureSession() {
  const session = await api('GET', '/api/session');
  const result = session.authRequired && !session.authenticated ? await showLogin() : session;
  if (result.authRequired) {
    $('menuUserRow').hidden = false;
    $('menuUser').textContent =
      (result.user || '') + (result.canEdit === false ? ' (pregled)' : '');
    $('logoutBtn').addEventListener('click', async () => {
      try {
        await api('POST', '/api/logout');
      } finally {
        location.reload();
      }
    });
  }
  return result;
}
