import { Link, type LinkProps } from 'react-router-dom';
import { buttonClasses } from './Button';
import { cx } from '../../lib/cx';

export interface ButtonLinkProps extends LinkProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
}

/** A navigation link that looks like a Button (same classes), for actions that change route. */
export function ButtonLink({ variant = 'primary', size = 'md', className, ...rest }: ButtonLinkProps) {
  return <Link className={cx(buttonClasses(variant, size), className)} {...rest} />;
}
