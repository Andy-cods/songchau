import { Mail, Phone, MessageCircle } from 'lucide-react'

interface ContactCardProps {
  title: string
  name?: string | null
  jobTitle?: string | null
  phone?: string | null
  email?: string | null
  zalo?: string | null
  wechat?: string | null
  line?: string | null
}

export default function ContactCard({
  title,
  name,
  jobTitle,
  phone,
  email,
  zalo,
  wechat,
  line,
}: ContactCardProps) {
  if (!name && !phone && !email) {
    return null
  }

  return (
    <div className="rounded-lg bg-stone-800/30 border border-stone-700/50 p-4">
      <h4 className="text-sm font-medium text-stone-400 uppercase tracking-wider mb-3">
        {title}
      </h4>

      {name && (
        <div className="mb-2">
          <p className="text-stone-200 font-medium">{name}</p>
          {jobTitle && <p className="text-sm text-stone-400">{jobTitle}</p>}
        </div>
      )}

      <div className="space-y-2">
        {phone && (
          <div className="flex items-center gap-2 text-sm">
            <Phone className="h-4 w-4 text-stone-500" />
            <a
              href={`tel:${phone}`}
              className="text-stone-300 hover:text-amber-400 transition-colors"
            >
              {phone}
            </a>
          </div>
        )}

        {email && (
          <div className="flex items-center gap-2 text-sm">
            <Mail className="h-4 w-4 text-stone-500" />
            <a
              href={`mailto:${email}`}
              className="text-stone-300 hover:text-amber-400 transition-colors"
            >
              {email}
            </a>
          </div>
        )}

        {zalo && (
          <div className="flex items-center gap-2 text-sm">
            <MessageCircle className="h-4 w-4 text-stone-500" />
            <span className="text-stone-300">
              Zalo: <span className="text-amber-400">{zalo}</span>
            </span>
          </div>
        )}

        {wechat && (
          <div className="flex items-center gap-2 text-sm">
            <MessageCircle className="h-4 w-4 text-stone-500" />
            <span className="text-stone-300">
              WeChat: <span className="text-green-400">{wechat}</span>
            </span>
          </div>
        )}

        {line && (
          <div className="flex items-center gap-2 text-sm">
            <MessageCircle className="h-4 w-4 text-stone-500" />
            <span className="text-stone-300">
              Line: <span className="text-emerald-400">{line}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
