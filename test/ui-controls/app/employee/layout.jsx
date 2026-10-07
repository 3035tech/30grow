import { EmployeeShell } from '../../../../app/_components/EmployeeShell';
import { DarkModeProvider } from '../../../../app/_components/DarkModeProvider';

// Match the product: collaborator navigation state survives page transitions.
export default function EmployeeFixtureLayout({ children }) {
  return <DarkModeProvider><EmployeeShell personName="Pessoa de teste" companyName="Empresa exemplo">{children}</EmployeeShell></DarkModeProvider>;
}
