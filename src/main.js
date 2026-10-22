import 'bootstrap/dist/css/bootstrap.min.css';
import './styles.css';
import { startRouter } from './router.js';
import { mountHeader } from './components/header/header.js';
import { mountFooter } from './components/footer/footer.js';

mountHeader(document.getElementById('header'));
mountFooter(document.getElementById('footer'));
startRouter(document.getElementById('app'));
