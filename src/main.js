import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.min.css';
import './styles.css';
import { startRouter } from './router.js';
import { mountHeader } from './components/header/header.js';
import { mountFooter } from './components/footer/footer.js';
import { initToasts, clearToasts } from './services/toast-service.js';
import { onAuthChange } from './services/auth-service.js';

initToasts();
// Messages belong to the user who triggered them.
onAuthChange(({ userChanged }) => userChanged && clearToasts());

mountHeader(document.getElementById('header'));
mountFooter(document.getElementById('footer'));
startRouter(document.getElementById('app'));
