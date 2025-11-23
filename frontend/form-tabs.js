// Form Tabs Handler - Obsługa przełączania między logowaniem a rejestracją

document.addEventListener('DOMContentLoaded', function() {
    // Pobieramy elementy
    const tabs = document.querySelectorAll('.tab');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    
    // Funkcja do przełączania formularzy
    function switchForm(targetForm) {
        // Usuń aktywne klasy ze wszystkich tabów
        tabs.forEach(tab => tab.classList.remove('active'));
        
        // Ukryj wszystkie formularze
        loginForm.classList.remove('active');
        registerForm.classList.remove('active');
        
        // Pokaż wybrany formularz
        if (targetForm === 'login') {
            tabs[0].classList.add('active'); // Pierwszy tab (Logowanie)
            loginForm.classList.add('active');
        } else if (targetForm === 'register') {
            tabs[1].classList.add('active'); // Drugi tab (Rejestracja)
            registerForm.classList.add('active');
        }
    }
    
    // Dodaj event listenery do tabów
    tabs.forEach((tab, index) => {
        tab.addEventListener('click', function() {
            if (index === 0) {
                switchForm('login');
            } else {
                switchForm('register');
            }
        });
        
        // Dodaj obsługę klawiatury dla accessibility
        tab.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.click();
            }
        });
    });
    
    // Ustaw domyślny formularz (logowanie)
    switchForm('login');
});

// Opcjonalne: Smooth transition effect
document.addEventListener('DOMContentLoaded', function() {
    const style = document.createElement('style');
    style.textContent = `
        .auth-form {
            opacity: 0;
            transform: translateY(10px);
            transition: all 0.3s ease;
            pointer-events: none;
        }
        
        .auth-form.active {
            opacity: 1;
            transform: translateY(0);
            pointer-events: auto;
        }
    `;
    document.head.appendChild(style);
});